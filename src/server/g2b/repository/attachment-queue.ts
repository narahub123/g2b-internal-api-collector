import { randomUUID } from "node:crypto";
import type { G2bDatabase } from "./database";

/** 수집 자료를 다시 읽을 때 사용하는 업무별 식별자다. */
export type AttachmentOwner = { section: "notices" | "order-plans" | "prior-specs"; number: string; revision: string };

/** 공개 목록의 행과 기존 다운로드 경로를 재현하는 데 필요한 정보다. */
export type AttachmentJobFile = {
  id: string; filename: string; owner: AttachmentOwner; source: string;
  group: string; seq: string; path?: string; bytes?: number;
};

type Claim = { file: AttachmentJobFile; token: string; attempts: number };
type Outcome = { hash: string } | { error: string; retry: boolean };
type AttachmentEvent = AttachmentOwner & { id: number; failures: number; generation: number };

// 운영자가 실패 횟수를 초기화한 뒤에도 이전 처리 결과를 거부할 수 있도록 세대를 함께 확인한다.
const currentEvent = "id = ? AND failures = ? AND generation = ? AND failed_at IS NULL";
const eventRetrySeconds = [30, 60, 120] as const;

/** 첨부 전용 상태와 실행권을 관리한다. 외부 다운로드 중에는 트랜잭션을 열어 두지 않는다. */
export function openAttachmentQueue(db: G2bDatabase) {
  const insert = db.prepare(`INSERT INTO g2b_attachment_jobs(id,file,priority) VALUES (?,?,?)
    ON CONFLICT(id) DO NOTHING`);
  const read = db.prepare("SELECT status, priority, attempts, hash, error FROM g2b_attachment_jobs WHERE id = ?");
  return {
    /** 수동 요청은 기존 대기 작업을 승격하고 실패한 작업의 시도 횟수를 초기화한다. */
    enqueue(file: AttachmentJobFile, manual: boolean) {
      return db.transaction(async () => {
        await insert.run(file.id, JSON.stringify(file), Number(manual));
        if (manual) {
          await db.prepare(`UPDATE g2b_attachment_jobs SET priority = 1, status = 'pending', available_at = 0,
            attempts = CASE WHEN status = 'failed' THEN 0 ELSE attempts END, error = NULL
            WHERE id = ? AND status IN ('pending', 'retry_wait', 'failed')`).run(file.id);
        }
        return read.get(file.id);
      });
    },
    /** 현재 파일의 상태와 해시를 관리자 화면에 반환한다. */
    status(id: string) { return read.get(id); },
    /** DB 시각에 실행 가능한 가장 이른 수집 이벤트를 반환한다. */
    async event() {
      return await db.prepare(`SELECT id, section, number, revision, failures, generation FROM g2b_attachment_events
        WHERE failed_at IS NULL AND available_at <= unixepoch() ORDER BY available_at, id LIMIT 1`)
        .get() as AttachmentEvent | undefined;
    },
    /** 현재 이벤트의 삭제와 등록을 함께 확정한다. 이미 처리된 시도는 false를 반환한다. */
    consume(event: AttachmentEvent, files: AttachmentJobFile[]) {
      return db.transaction(async () => {
        const deleted = await db.prepare(`DELETE FROM g2b_attachment_events WHERE ${currentEvent}`)
          .run(event.id, event.failures, event.generation);
        if (!deleted.rowsAffected) return false;
        for (const file of files) await insert.run(file.id, JSON.stringify(file), 0);
        return true;
      });
    },
    /** 최신 시도만 지연하거나 최종 실패로 기록한다. 다른 워커에서 처리했다면 결과가 없다. */
    async failEvent(event: AttachmentEvent, error: string) {
      const retry = eventRetrySeconds[event.failures];
      return db.prepare(`UPDATE g2b_attachment_events SET failures = failures + 1, error = ?,
        available_at = unixepoch() + ?, failed_at = CASE WHEN ? THEN unixepoch() END
        WHERE ${currentEvent} RETURNING failures, available_at AS retryAt, failed_at AS failedAt`)
        .get(error.slice(0, 300), retry ?? 0, Number(retry === undefined), event.id, event.failures, event.generation);
    },
    /** 만료·재시도 대기를 회수하고 수동 우선, 등록 순으로 한 파일을 원자적으로 선점한다. */
    async claim(): Promise<Claim | undefined> {
      // 유휴 워커가 수집 저장과 쓰기 잠금을 두고 경쟁하지 않게 먼저 읽기만 한다.
      const ready = await db.prepare(`SELECT 1 WHERE
        EXISTS (SELECT 1 FROM g2b_attachment_jobs WHERE status = 'pending') OR
        EXISTS (SELECT 1 FROM g2b_attachment_jobs WHERE status = 'retry_wait' AND available_at <= unixepoch()) OR
        EXISTS (SELECT 1 FROM g2b_attachment_jobs WHERE status = 'running' AND expires_at <= unixepoch())`).get();
      if (!ready) return;
      const token = randomUUID();
      return db.transaction(async () => {
        await db.prepare(`UPDATE g2b_attachment_jobs SET status = 'pending'
          WHERE status = 'retry_wait' AND available_at <= unixepoch()`).run();
        await db.prepare(`UPDATE g2b_attachment_jobs
          SET status = CASE WHEN attempts >= 4 THEN 'failed' ELSE 'pending' END,
          token = NULL, expires_at = NULL, error = '첨부 작업 선점 만료'
          WHERE status = 'running' AND expires_at <= unixepoch()`).run();
        const row = await db.prepare(`UPDATE g2b_attachment_jobs
          SET status = 'running', token = ?, expires_at = unixepoch() + 90, attempts = attempts + 1
          WHERE position = (SELECT position FROM g2b_attachment_jobs WHERE status = 'pending'
            ORDER BY priority DESC, position LIMIT 1) RETURNING file, attempts`).get(token);
        if (row) return { file: JSON.parse(String(row.file)), token, attempts: Number(row.attempts) };
      });
    },
    /** DB 시각 기준으로 유효한 동일 토큰만 선점을 연장한다. */
    async renew(claim: Claim) {
      return Boolean((await db.prepare(`UPDATE g2b_attachment_jobs SET expires_at = unixepoch() + 90
        WHERE id = ? AND token = ? AND status = 'running' AND expires_at > unixepoch()`)
        .run(claim.file.id, claim.token)).rowsAffected);
    },
    /** 현재 실행권의 결과만 기록하며 일시 실패는 30·60·120초 후 재시도한다. */
    async finish(claim: Claim, outcome: Outcome) {
      const success = "hash" in outcome;
      const retry = !success && outcome.retry && claim.attempts < 4;
      return Boolean((await db.prepare(`UPDATE g2b_attachment_jobs
        SET status = ?, available_at = unixepoch() + ?, hash = ?, error = ?, token = NULL, expires_at = NULL
        WHERE id = ? AND token = ? AND status = 'running' AND expires_at > unixepoch()`)
        .run(success ? "succeeded" : retry ? "retry_wait" : "failed",
          retry ? 30 * 2 ** (claim.attempts - 1) : 0, success ? outcome.hash : null,
          success ? null : outcome.error, claim.file.id, claim.token)).rowsAffected);
    },
  };
}
