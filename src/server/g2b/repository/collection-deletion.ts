import type { G2bDatabase } from "./database";
import type { CollectionSection } from "./collection-attempts";
import { orderPlanSourceNumbersSql } from "./order-plan-list-links";

// 사용하지 않는 차수는 시도 이력의 키와 동일하게 빈 문자열로 표현한다.
export type CollectionDeletionKey = {
  number: string;
  revision: string;
  openingRevision: string;
};

// Turso가 삭제한 시도 ID를 재사용할 수 있으므로 시작 시각도 함께 비교한다.
export type CollectionDeletionTarget = CollectionDeletionKey & {
  collectedAt: string | null;
  attemptId: number | null;
  attemptStartedAt: string | null;
};

const storage = {
  "order-plans": { table: "order_plans", columns: ["number"] },
  "prior-specs": { table: "prior_specs", columns: ["number"] },
  notices: { table: "notices", columns: ["number", "revision"] },
  "contract-requests": { table: "contract_requests", columns: ["number", "revision"] },
  "opening-results": { table: "opening_results", columns: ["number", "revision", "opening_revision"] },
  contracts: { table: "contracts", columns: ["number", "revision"] },
} satisfies Record<CollectionSection, { table: string; columns: string[] }>;

type DeletionResult =
  | { ok: true; hasOtherOpeningResults: boolean }
  | { ok: false; reason: "busy" | "changed" };

/**
 * 업무별 저장 키와 시도 이력을 동일한 SQLite 연결에서 확인하고 삭제한다.
 * 발주계획은 목록이 같은 행으로 묶는 호출 번호의 이력도 함께 처리한다.
 */
export function openCollectionDeletion(db: G2bDatabase) {
  function statements(section: CollectionSection) {
    const { table, columns } = storage[section];
    const savedWhere = columns.map((column) => `${column} = ?`).join(" AND ");
    const attemptWhere = "number = ? AND revision = ? AND opening_revision = ?";
    // 발주계획은 대상 번호의 원래 요청 번호만 찾고 각 차수의 이력 인덱스를 탐색한다.
    const matchingAttempts = section === "order-plans"
      ? `WITH target(number, revision, opening_revision) AS (VALUES (?, ?, ?)),
          sources AS (${orderPlanSourceNumbersSql("target.number", "FROM target")})
         SELECT attempt.id FROM sources CROSS JOIN target
         CROSS JOIN g2b_collection_attempts attempt ON attempt.section = 'order-plans' AND attempt.number = sources.source_number
           AND attempt.revision = target.revision AND attempt.opening_revision = target.opening_revision`
      : `SELECT id FROM g2b_collection_attempts WHERE section = ? AND ${attemptWhere}`;
    return {
      keyLength: columns.length,
      readSaved: db.prepare(`SELECT collected_at AS collectedAt FROM ${table} WHERE ${savedWhere}`),
      deleteSaved: db.prepare(`DELETE FROM ${table} WHERE ${savedWhere}`),
      readAttempts: db.prepare(`
        SELECT id, started_at AS startedAt, MAX(status = 'pending') OVER () AS hasPending
        FROM g2b_collection_attempts WHERE id IN (${matchingAttempts})
        ORDER BY id DESC LIMIT 1
      `),
      deleteAttempts: db.prepare(`DELETE FROM g2b_collection_attempts WHERE id IN (${matchingAttempts})`),
    };
  }

  const sections = new Map<CollectionSection, ReturnType<typeof statements>>();
  const activeNoticeJob = db.prepare(`
    SELECT 1 FROM g2b_notice_jobs
    WHERE number = ? AND revision = ? AND status IN ('pending', 'retry_wait', 'running') LIMIT 1
  `);

  function queriesFor(section: CollectionSection) {
    const existing = sections.get(section);
    if (existing) return existing;
    const prepared = statements(section);
    sections.set(section, prepared);
    return prepared;
  }

  function parameters(section: CollectionSection, key: CollectionDeletionKey) {
    const parts = [key.number, key.revision, key.openingRevision];
    return {
      saved: parts.slice(0, queriesFor(section).keyLength),
      attempts: section === "order-plans" ? parts : [section, ...parts],
    };
  }

  /**
   * 현재 저장 시각, 최신 이력과 삭제를 차단할 수집 상태를 조회한다.
   * 큐에만 등록되어 아직 시도를 시작하지 않은 공고도 삭제를 차단한다.
   * @throws Turso에서 저장 데이터나 수집 상태를 읽지 못한 경우.
   */
  async function snapshot(section: CollectionSection, key: CollectionDeletionKey) {
    const queries = queriesFor(section);
    const params = parameters(section, key);
    const saved = await queries.readSaved.get(...params.saved) as { collectedAt: string } | undefined;
    const attempt = await queries.readAttempts.get(...params.attempts) as {
      id: number;
      startedAt: string;
      hasPending: number;
    } | undefined;
    return {
      target: {
        number: key.number,
        revision: key.revision,
        openingRevision: key.openingRevision,
        collectedAt: saved?.collectedAt ?? null,
        attemptId: attempt?.id ?? null,
        attemptStartedAt: attempt?.startedAt ?? null,
      },
      blocked: Boolean(attempt?.hasPending || (
        section === "notices" && (await activeNoticeJob.get(key.number, key.revision))
      )),
    };
  }

  /**
   * 쓰기 잠금 아래 전체 대상의 변경·수집 여부를 확인한 뒤 원본과 이력을 함께 삭제한다.
   * @returns 수집 중이거나 화면의 버전과 달라지면 아무 행도 삭제하지 않고 사유를 반환한다.
   * @throws SQLite 처리에 실패한 경우 배치를 롤백하고 오류를 전달한다.
   */
  function remove(section: CollectionSection, targets: CollectionDeletionTarget[]) {
    return db.transaction<DeletionResult>(async () => {
      for (const expected of targets) {
        const { target, blocked } = await snapshot(section, expected);
        const changed = (target.collectedAt !== null || target.attemptId !== null) && (
          target.collectedAt !== expected.collectedAt ||
          target.attemptId !== expected.attemptId ||
          target.attemptStartedAt !== expected.attemptStartedAt
        );
        if (blocked || changed) {
          return { ok: false, reason: blocked ? "busy" : "changed" };
        }
      }

      const queries = queriesFor(section);
      for (const target of targets) {
        const params = parameters(section, target);
        // 발주계획 호출 번호의 연결은 원본을 지우기 전에 확인한다.
        await queries.deleteAttempts.run(...params.attempts);
        await queries.deleteSaved.run(...params.saved);
      }
      const first = targets[0];
      const hasOtherOpeningResults = section === "opening-results" && targets.length === 1 && Boolean(
        await db.prepare("SELECT 1 FROM opening_results WHERE number = ? AND revision = ? LIMIT 1")
          .get(first.number, first.revision),
      );
      return { ok: true, hasOtherOpeningResults };
    });
  }

  return { snapshot, remove };
}
