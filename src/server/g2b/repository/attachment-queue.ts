import { randomUUID } from "node:crypto";
import {
  ATTACHMENT_EVENT_RETRY_SECONDS,
  ATTACHMENT_LEASE_SECONDS,
  ATTACHMENT_MAX_ATTEMPTS,
  ATTACHMENT_RETRY_BASE_SECONDS,
} from "@/shared/config/g2b-attachment-worker";
import { findAttachmentExtractor, type AttachmentExtraction, type AttachmentExtractor } from "@/shared/model/g2b/attachment-extraction";
import type { G2bDatabase } from "./database";

/** 수집 자료를 다시 읽을 때 사용하는 업무별 식별자다. */
export type AttachmentOwner = { section: "notices" | "order-plans" | "prior-specs"; number: string; revision: string };

/** 공개 목록의 행과 기존 다운로드 경로를 재현하는 데 필요한 정보다. */
export type AttachmentJobFile = {
  id: string; filename: string; owner: AttachmentOwner; source: string;
  group: string; seq: string; path?: string; bytes?: number;
};

type Mode = "hash_only" | "extract";
type Claim = { file: AttachmentJobFile; token: string; attempts: number; mode: Mode };
type Outcome = { hash: string; extraction?: { format: string; version: string; result?: AttachmentExtraction } } | { error: string; retry: boolean };
type AttachmentEvent = AttachmentOwner & { id: number; failures: number; generation: number };

// 운영자가 실패 횟수를 초기화한 뒤에도 이전 처리 결과를 거부할 수 있도록 세대를 함께 확인한다.
const currentEvent = "id = ? AND failures = ? AND generation = ? AND failed_at IS NULL";

// 텍스트 저장의 DB 왕복을 줄이면서 배치의 바인딩 크기를 제한한다.
function* unitBatches(units: string[]) {
  let batch: string[] = [];
  let bytes = 2;
  for (const [index, text] of units.entries()) {
    const entry = JSON.stringify([index + 1, text]);
    const entryBytes = Buffer.byteLength(entry) + 1;
    if (batch.length && bytes + entryBytes > 128 * 1024) {
      yield `[${batch.join(",")}]`;
      batch = [];
      bytes = 2;
    }
    batch.push(entry);
    bytes += entryBytes;
  }
  if (batch.length) yield `[${batch.join(",")}]`;
}

/**
 * 첨부 전용 상태와 실행권을 관리한다. 외부 다운로드 중에는 트랜잭션을 열어 두지 않는다.
 * @param resolveExtractor 자동·수동 접수에서 작업 모드와 캐시 키를 결정한다.
 */
export function openAttachmentQueue(db: G2bDatabase, workerToken?: string, resolveExtractor = findAttachmentExtractor) {
  const insert = db.prepare(`INSERT INTO g2b_attachment_jobs(id,file,priority,mode) VALUES (?,?,?,?)
    ON CONFLICT(id) DO NOTHING`);
  const read = db.prepare(`SELECT j.status, j.priority, j.attempts, j.hash, j.error, j.mode,
    j.result_id AS resultId, r.character_count AS characterCount, r.unit_count AS unitCount, r.format
    FROM g2b_attachment_jobs j LEFT JOIN g2b_attachment_results r ON r.id = j.result_id WHERE j.id = ?`);
  const findResult = db.prepare("SELECT id FROM g2b_attachment_results WHERE hash = ? AND format = ? AND extractor_version = ?");
  const ownsJob = "id = ? AND token = ? AND status = 'running' AND expires_at > unixepoch()";
  async function verifyWorker() {
    if (!await db.prepare(`SELECT 1 FROM g2b_attachment_dispatch WHERE id = 1 AND worker_token = ?
      AND worker_expires_at > unixepoch()`).get(workerToken!)) {
      throw new Error("첨부 워커 실행권이 만료되었거나 교체되었습니다.");
    }
  }
  // 실행권 판정과 큐 변경을 같은 쓰기 트랜잭션에 묶어 이전 워커의 결과를 차단한다.
  function workerTransaction<T>(work: () => Promise<T>) {
    return db.transaction(async () => {
      if (workerToken) await verifyWorker();
      const result = await work();
      if (workerToken) await verifyWorker();
      return result;
    });
  }
  return {
    /**
     * 수동 추출 요청은 이전 해시 확인 작업도 추출로 승격하며 저장된 결과를 재사용한다.
     * @returns 작업 상태와 신규 등록·승격·재대기로 실행 요청이 필요한지를 반환한다.
     * @throws DB 조회나 저장 실패 시 등록 트랜잭션을 롤백한다.
     */
    enqueue(file: AttachmentJobFile, manual: boolean) {
      return db.transaction(async () => {
        const extractor = resolveExtractor(file.filename);
        const inserted = await insert.run(file.id, JSON.stringify(file), Number(manual), extractor ? "extract" : "hash_only");
        let changed = Boolean(inserted.rowsAffected);
        if (manual && extractor) {
          const current = await read.get(file.id);
          if (!current) return;
          if (current.resultId != null) return { job: current, shouldDispatch: false };
          const cached = typeof current.hash === "string" && current.status !== "running"
            ? await findResult.get(current.hash, extractor.format, extractor.version) : undefined;
          // 이미 수동 추출 대기 중인 작업은 다시 제출해도 새 실행을 예약하지 않는다.
          const alreadyPending = current.status === "pending" && current.priority === 1 && current.mode === "extract";
          if (alreadyPending && !cached) return { job: current, shouldDispatch: changed };
          await db.prepare(`UPDATE g2b_attachment_jobs SET priority = 1, mode = 'extract',
            status = CASE WHEN status = 'running' THEN status WHEN ? IS NOT NULL THEN 'succeeded' ELSE 'pending' END,
            result_id = ?, available_at = 0,
            attempts = CASE WHEN mode = 'hash_only' OR status IN ('failed','succeeded') THEN 0 ELSE attempts END,
            error = NULL WHERE id = ?`).run(cached?.id ?? null, cached?.id ?? null, file.id);
          changed = true;
        } else if (manual) {
          const updated = await db.prepare(`UPDATE g2b_attachment_jobs SET priority = 1, status = 'pending', available_at = 0,
            attempts = CASE WHEN status = 'failed' THEN 0 ELSE attempts END, error = NULL
            WHERE id = ? AND (status IN ('retry_wait', 'failed') OR (status = 'pending' AND priority = 0))`).run(file.id);
          changed ||= Boolean(updated.rowsAffected);
        }
        const current = await read.get(file.id);
        return current && { job: current, shouldDispatch: manual && changed && current.status === "pending" };
      });
    },
    /** 현재 파일의 상태와 해시를 관리자 화면에 반환한다. */
    status(id: string) { return read.get(id); },
    /** 동일한 원본 바이트, 형식, 추출기 버전으로 저장된 결과가 있는지 확인한다. */
    async hasExtraction(hash: string, extractor: Pick<AttachmentExtractor, "format" | "version">) {
      return Boolean(await findResult.get(hash, extractor.format, extractor.version));
    },
    /** DB 시각에 실행 가능한 가장 이른 수집 이벤트를 반환한다. */
    async event() {
      return await db.prepare(`SELECT id, section, number, revision, failures, generation FROM g2b_attachment_events
        WHERE failed_at IS NULL AND available_at <= unixepoch() ORDER BY available_at, id LIMIT 1`)
        .get() as AttachmentEvent | undefined;
    },
    /** 현재 이벤트의 삭제와 등록을 함께 확정한다. 이미 처리된 시도는 false를 반환한다. */
    consume(event: AttachmentEvent, files: AttachmentJobFile[]) {
      return workerTransaction(async () => {
        const deleted = await db.prepare(`DELETE FROM g2b_attachment_events WHERE ${currentEvent}`)
          .run(event.id, event.failures, event.generation);
        if (!deleted.rowsAffected) return false;
        for (const file of files) {
          await insert.run(file.id, JSON.stringify(file), 0, resolveExtractor(file.filename) ? "extract" : "hash_only");
        }
        return true;
      });
    },
    /** 최신 시도만 지연하거나 최종 실패로 기록한다. 다른 워커에서 처리했다면 결과가 없다. */
    async failEvent(event: AttachmentEvent, error: string) {
      const retry = ATTACHMENT_EVENT_RETRY_SECONDS[event.failures];
      return workerTransaction(() => db.prepare(`UPDATE g2b_attachment_events SET failures = failures + 1, error = ?,
        available_at = unixepoch() + ?, failed_at = CASE WHEN ? THEN unixepoch() END
        WHERE ${currentEvent} RETURNING failures, available_at AS retryAt, failed_at AS failedAt`)
        .get(error.slice(0, 300), retry ?? 0, Number(retry === undefined), event.id, event.failures, event.generation));
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
      return workerTransaction(async () => {
        await db.prepare(`UPDATE g2b_attachment_jobs SET status = 'pending'
          WHERE status = 'retry_wait' AND available_at <= unixepoch()`).run();
        await db.prepare(`UPDATE g2b_attachment_jobs
          SET status = CASE WHEN attempts >= ${ATTACHMENT_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
          token = NULL, expires_at = NULL, error = '첨부 작업 선점 만료'
          WHERE status = 'running' AND expires_at <= unixepoch()`).run();
        const row = await db.prepare(`UPDATE g2b_attachment_jobs
          SET status = 'running', token = ?, expires_at = unixepoch() + ${ATTACHMENT_LEASE_SECONDS}, attempts = attempts + 1
          WHERE position = (SELECT position FROM g2b_attachment_jobs WHERE status = 'pending'
            ORDER BY priority DESC, position LIMIT 1) RETURNING file, attempts, mode`).get(token);
        if (row) return { file: JSON.parse(String(row.file)), token, attempts: Number(row.attempts), mode: row.mode as Mode };
      });
    },
    /** DB 시각 기준으로 유효한 동일 토큰만 선점을 연장한다. */
    async renew(claim: Claim) {
      return workerTransaction(async () => Boolean((await db.prepare(`UPDATE g2b_attachment_jobs SET expires_at = unixepoch() + ${ATTACHMENT_LEASE_SECONDS}
        WHERE id = ? AND token = ? AND status = 'running' AND expires_at > unixepoch()`)
        .run(claim.file.id, claim.token)).rowsAffected));
    },
    /** 현재 실행권의 결과만 저장하고 추출 결과와 첨부 완료를 같은 트랜잭션에서 확정한다. */
    async finish(claim: Claim, outcome: Outcome) {
      return workerTransaction(async () => {
        const key = [claim.file.id, claim.token] as const;
        const job = await db.prepare(`SELECT mode FROM g2b_attachment_jobs WHERE ${ownsJob}`).get(...key);
        if (!job) return false;
        const promoted = claim.mode === "hash_only" && job.mode === "extract";
        const success = "hash" in outcome;
        if (success && claim.mode === "extract" && !outcome.extraction) {
          throw new Error("첨부 추출 작업에 완료 결과가 없습니다.");
        }
        const retry = !success && outcome.retry && claim.attempts < ATTACHMENT_MAX_ATTEMPTS;
        let resultId = null;
        if (success && outcome.extraction) {
          const { format, version, result } = outcome.extraction;
          let saved = await findResult.get(outcome.hash, format, version);
          if (!saved && result) {
            const characterCount = result.units.reduce((count, text) => count + text.length, 0);
            saved = await db.prepare(`INSERT INTO g2b_attachment_results(hash,format,extractor_version,unit_count,character_count)
              VALUES (?,?,?,?,?) RETURNING id`).get(outcome.hash, format, version, result.units.length, characterCount);
            const insertUnits = db.prepare(`INSERT INTO g2b_attachment_result_units(result_id,unit_number,text)
              SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)`);
            for (const batch of unitBatches(result.units)) await insertUnits.run(saved!.id, batch);
          }
          if (!saved) throw new Error("재사용할 첨부 추출 결과가 없습니다.");
          resultId = saved.id;
        }
        const updated = await db.prepare(`UPDATE g2b_attachment_jobs SET status = ?, available_at = unixepoch() + ?,
          hash = COALESCE(?, hash), error = ?, result_id = ?, token = NULL, expires_at = NULL WHERE ${ownsJob}`)
          .run(promoted ? "pending" : success ? "succeeded" : retry ? "retry_wait" : "failed",
            !promoted && retry ? ATTACHMENT_RETRY_BASE_SECONDS * 2 ** (claim.attempts - 1) : 0,
            success ? outcome.hash : null, success || promoted ? null : outcome.error, resultId, ...key);
        // 텍스트 저장 도중 실행권이 만료되면 결과까지 함께 롤백한다.
        if (!updated.rowsAffected) throw new Error("첨부 작업 실행권이 결과 저장 중 만료되었습니다.");
        return true;
      });
    },
  };
}
