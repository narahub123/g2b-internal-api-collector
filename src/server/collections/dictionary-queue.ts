import { randomUUID } from "node:crypto";
import type { DictionaryId } from "@/_pages/admin/manage/dictionaries";
import type { G2bDatabase } from "@/server/g2b/repository/database";
import { getG2bDatabase } from "@/server/g2b/repository";

/** 화면의 설정과 다음 확인 일정을 나타낸다. */
export type DictionarySchedule = {
  /** 설정이 속한 사전. */
  key: DictionaryId;
  /** 정기 변경 확인을 사용할지 여부. */
  enabled: boolean;
  /** 확인 간격의 일수. */
  days: number;
  /** 마지막으로 확인에 성공한 UTC 밀리초. */
  lastSuccessAt: number | null;
  /** 다음 실행을 접수할 수 있는 UTC 밀리초. */
  nextAt: number | null;
};

/** 화면에 표시할 큐 상태다. */
export type DictionaryJobStatus = "pending" | "running" | "retry_wait" | "succeeded" | "failed" | "cancelled";
/** 수집기가 성공적으로 확인한 결과다. */
export type DictionaryOutcome = "created" | "updated" | "unchanged";

// 사전 워커만 사용하는 재시도 간격과 정상 업무의 실행권 시간을 정의한다.
export const dictionaryRetryMs = 15 * 60_000;
const workerLeaseMs = 5 * 60_000;
// 최초 실행을 포함해 실패 세 번이면 해당 작업을 종료한다.
const maxFailures = 3;
const dispatchWindowMs = 3 * 60_000;
const dayMs = 86_400_000;
const active = "status IN ('pending','running','retry_wait')";
const ready = "status IN ('pending','retry_wait') AND available_at <= ?";

// 테스트의 실행 계획과 실제 정기·선점·정리 코드에서 같은 SQL을 사용한다.
export const dictionaryQueueQueries = {
  // 만료된 단일 실행권과 그 토큰으로 선점한 작업만 확인한다.
  expired: `SELECT j.id, j.key, j.source, j.failures, s.enabled, s.interval_seconds, w.expires_at
    FROM dictionary_worker w JOIN dictionary_jobs j ON j.worker_token = w.token
    JOIN collection_schedule_settings s ON s.key = j.key
    WHERE w.id = 1 AND w.expires_at <= ? AND j.status = 'running'`,
  due: `SELECT t.key FROM dictionary_schedule_state t INDEXED BY dictionary_schedule_due
    JOIN collection_schedule_settings s ON s.key = t.key
    WHERE t.next_at IS NOT NULL AND t.next_at <= ? AND s.enabled = 1
    AND NOT EXISTS (SELECT 1 FROM dictionary_jobs j WHERE j.key = t.key AND ${active}) ORDER BY t.next_at, t.key`,
  // 활성 작업은 사전당 하나라 지연된 후보가 있어도 접수순으로 좁은 범위만 확인한다.
  ready: `SELECT id FROM dictionary_jobs WHERE source = ? AND ${ready} ORDER BY id LIMIT 1`,
  cleanup: "SELECT id FROM dictionary_jobs WHERE status = 'succeeded' AND had_failure = 0 AND finished_at <= ? ORDER BY finished_at LIMIT 100",
};

/**
 * 독립적인 사전 큐와 공용 설정 테이블을 서버 연결에 연결한다.
 * @returns 요청과 워커에서 사용할 사전 큐.
 */
export function getDictionaryQueue() {
  // 서버 인스턴스가 같은 libSQL 클라이언트를 다시 사용한다.
  return sharedQueue ??= openDictionaryQueue(getG2bDatabase());
}

// 관리 화면마다 새 DB 연결을 열지 않도록 저장소를 보관한다.
let sharedQueue: ReturnType<typeof openDictionaryQueue> | undefined;

/**
 * 사전별 실행 상태와 단일 워커 선점을 관리한다.
 * @param db 마이그레이션을 적용한 공유 DB.
 * @returns 설정, 수집, 정리 작업.
 */
export function openDictionaryQueue(db: G2bDatabase) {
  /**
   * 두 사전의 영속 설정과 실행 시각을 조회한다.
   * @returns 사전별 설정 및 실행 일정.
   */
  async function settings(): Promise<DictionarySchedule[]> {
    const rows = await db.prepare(`SELECT s.key, s.enabled, s.interval_seconds, t.last_success_at, t.next_at
      FROM dictionary_schedule_state t JOIN collection_schedule_settings s ON s.key = t.key`).all();
    return rows.map((row) => ({
      key: row.key as DictionaryId, enabled: Number(row.enabled) === 1, days: Number(row.interval_seconds) / 86400,
      lastSuccessAt: row.last_success_at == null ? null : Number(row.last_success_at),
      nextAt: row.next_at == null ? null : Number(row.next_at),
    }));
  }

  /**
   * 일정 변경과 대기 자동 작업의 취소를 함께 반영한다.
   * @param key 관리자에게 허용된 사전.
   * @param enabled 자동 확인 여부.
   * @param days 양의 정수 확인 일수.
   * @param now 설정을 적용한 시각.
   */
  async function configure(key: DictionaryId, enabled: boolean, days: number, now = Date.now()) {
    if (!Number.isSafeInteger(days) || days < 1 || days > Math.floor((Number.MAX_SAFE_INTEGER - now) / dayMs)) {
      throw new RangeError("확인 주기는 양의 정수 일수여야 합니다.");
    }
    await db.transaction(async () => {
      // 설정은 공고와 같은 테이블에 두고 사전의 실행 시각만 별도 갱신한다.
      const setting = await db.prepare("SELECT enabled, interval_seconds FROM collection_schedule_settings WHERE key = ?").get(key);
      if (!setting) throw new Error("사전 자동 수집 설정 없음");
      if (Number(setting.enabled) === Number(enabled) && Number(setting.interval_seconds) === days * 86400) return;
      await db.prepare("UPDATE collection_schedule_settings SET enabled = ?, interval_seconds = ? WHERE key = ?")
        .run(Number(enabled), days * 86400, key);
      await db.prepare(`UPDATE dictionary_schedule_state
        SET next_at = CASE WHEN ? = 1 THEN COALESCE(last_success_at + ?, ?) END WHERE key = ?`)
        .run(Number(enabled), days * dayMs, now, key);
      if (!enabled) {
        await db.prepare(`UPDATE dictionary_jobs SET status = 'cancelled', finished_at = ?
          WHERE key = ? AND source = 'automatic' AND status IN ('pending','retry_wait')`).run(now, key);
      }
    });
  }

  /**
   * 사용자 요청을 사전별로 접수하고 이미 활성인 작업의 ID를 재사용한다.
   * @param keys 한 사전 또는 전체 사전.
   * @param now 접수 시각.
   * @returns 화면이 추적할 작업 ID.
   */
  function enqueueManual(keys: readonly DictionaryId[], now = Date.now()) {
    return db.transaction(async () => {
      // 중단된 실행을 먼저 정리해 수동 요청이 만료된 작업의 실행을 다시 호출할 수 있게 한다.
      await recover(now);
      const ids: number[] = [];
      for (const key of keys) {
        // 재시도 대기 중에도 사용자가 수동으로 즉시 실행할 수 있게 한다.
        await db.prepare(`UPDATE dictionary_jobs SET source = 'manual', status = 'pending', available_at = ?
          WHERE key = ? AND source = 'automatic' AND status IN ('pending','retry_wait')`).run(now, key);
        await db.prepare(`INSERT OR IGNORE INTO dictionary_jobs(key,source,status,available_at)
          VALUES (?,'manual','pending',?)`).run(key, now);
        const job = await db.prepare(`SELECT id FROM dictionary_jobs WHERE key = ? AND ${active}`).get(key);
        ids.push(Number(job.id));
      }
      return ids;
    });
  }

  /**
   * 만료된 실행을 재접수하고 확인 기한이 지난 사전만 정기 접수한다.
   * @param now 정기 호출의 기준 시각.
   */
  async function tick(now = Date.now()) {
    await db.transaction(async () => {
      await recover(now);
      const due = await db.prepare(dictionaryQueueQueries.due).all(now);
      for (const { key } of due) {
        await db.prepare(`INSERT OR IGNORE INTO dictionary_jobs(key,source,status,available_at)
          VALUES (?,'automatic','pending',?)`).run(key, now);
      }
    });
  }

  /**
   * 만료된 작업을 실패로 집계하고 남은 시도에 따라 재예약하거나 종료한다.
   * @param now 실행권 만료를 판단할 시각.
   * @throws 작업 또는 다음 일정을 변경하지 못하면 호출자의 트랜잭션을 중단한다.
   */
  async function recover(now: number) {
    // 정기 호출과 선점 트랜잭션에서 만료된 한 건을 찾는다.
    const job = await db.prepare(dictionaryQueueQueries.expired).get(now);
    if (!job) return;
    // 자동 작업은 비활성화 여부를 우선 적용하고 수동 작업은 남은 시도만 즉시 복구한다.
    const automatic = job.source === "automatic";
    const status = automatic && !Number(job.enabled) ? "cancelled"
      : Number(job.failures) + 1 >= maxFailures ? "failed" : automatic ? "retry_wait" : "pending";
    // 자동 재시도는 만료 시각에서 15분이 지난 뒤 가능하다.
    const availableAt = status === "retry_wait" ? Number(job.expires_at) + dictionaryRetryMs : now;
    const finishedAt = status === "cancelled" || status === "failed" ? now : null;
    // 한 번 복구한 작업은 실행 중 상태에서 벗어나 같은 만료를 다시 집계하지 않는다.
    await db.prepare(`UPDATE dictionary_jobs SET status = ?, available_at = ?, finished_at = ?,
      worker_token = NULL, failures = failures + 1, had_failure = 1 WHERE id = ?`)
      .run(status, availableAt, finishedAt, job.id);
    // 한도를 소진한 자동 작업은 마지막 성공 시각을 보존하고 다음 정기 확인만 예약한다.
    if (automatic && status === "failed") {
      await db.prepare("UPDATE dictionary_schedule_state SET next_at = ? WHERE key = ?")
        .run(now + Number(job.interval_seconds) * 1000, job.key);
    }
  }

  /**
   * 공고 워커와 같은 토큰·만료 조건으로 현재 실행권을 연장한다.
   * @param token 현재 작업을 선점한 실행권.
   * @param now 실행권의 유효성과 새 만료 시각을 계산할 기준 시각.
   * @returns 연장 성공 여부. 토큰이 바뀌었거나 이미 만료됐으면 false.
   * @throws DB에서 실행권을 갱신하지 못한 경우.
   */
  async function renew(token: string, now = Date.now()) {
    // 유효한 소유자만 실행권을 연장할 수 있다.
    const result = await db.prepare(`UPDATE dictionary_worker SET expires_at = ?
      WHERE id = 1 AND token = ? AND expires_at > ?`).run(now + workerLeaseMs, token, now);
    return result.rowsAffected === 1;
  }

  /**
   * 즉시 실행할 작업을 고른다. 수동 후보가 없을 때만 자동 후보를 찾는다.
   * @param now 준비 여부를 판단할 시각.
   * @returns 선점할 작업 ID 또는 빈 값.
   */
  async function readyJob(now: number) {
    const query = db.prepare(dictionaryQueueQueries.ready);
    return await query.get("manual", now) ?? await query.get("automatic", now);
  }

  /**
   * 워크플로 호출 전 임시 예약을 얻어 겹친 요청을 줄인다.
   * @param now 현재 시각.
   * @returns 예약 소유권 또는 실행을 요청할 필요가 없을 때 빈 값.
   */
  async function reserve(now = Date.now()) {
    if (!await readyJob(now)) return undefined;
    const token = randomUUID();
    const row = await db.prepare(`UPDATE dictionary_worker SET dispatch_token = ?, dispatch_until = ?
      WHERE id = 1 AND dispatch_until <= ? AND expires_at <= ? RETURNING id`).get(token, now + dispatchWindowMs, now, now);
    return row ? token : undefined;
  }

  /**
   * 실패한 호출의 예약만 반환한다.
   * @param token 이번 호출에서 얻은 예약 소유권.
   */
  async function releaseDispatch(token: string) {
    await db.prepare("UPDATE dictionary_worker SET dispatch_token = NULL, dispatch_until = 0 WHERE dispatch_token = ?").run(token);
  }

  /**
   * 실행권과 다음 작업을 같은 트랜잭션에서 선점한다.
   * @param now 실행 기준 시각.
   * @returns 다른 실행이 작업 중인 경우 busy, 작업 또는 빈 큐.
   */
  function claim(now = Date.now()) {
    return db.transaction(async () => {
      const worker = await db.prepare("SELECT token, expires_at FROM dictionary_worker WHERE id = 1").get();
      if (worker.token && Number(worker.expires_at) > now) return { kind: "busy" } as const;
      await recover(now);
      const ready = await readyJob(now);
      // 러너가 시작했으므로 이 호출에 사용된 예약은 소비한다.
      await db.prepare("UPDATE dictionary_worker SET dispatch_until = 0, dispatch_token = NULL WHERE id = 1").run();
      if (!ready) return { kind: "empty" } as const;
      const token = randomUUID();
      await db.prepare("UPDATE dictionary_worker SET token = ?, expires_at = ? WHERE id = 1").run(token, now + workerLeaseMs);
      const job = await db.prepare(`UPDATE dictionary_jobs SET status = 'running', worker_token = ? WHERE id = ?
        RETURNING id,key`).get(token, ready.id);
      return { kind: "job", id: Number(job.id), key: job.key as DictionaryId, token } as const;
    });
  }

  /**
   * 소유한 작업만 완료하고 같은 트랜잭션에서 다음 확인과 실행권을 갱신한다.
   * @param id 실행한 작업.
   * @param token 해당 실행의 소유권.
   * @param outcome 정상 확인 결과 또는 재시도 여부를 포함한 실패.
   * @param now 완료 시각.
   * @returns 이번 실패에서 예약된 재시도 시각.
   */
  function finish(id: number, token: string, outcome: DictionaryOutcome | { retry: boolean }, now = Date.now()) {
    return db.transaction(async () => {
      const job = await db.prepare(`SELECT j.key, j.source, j.failures, s.enabled, s.interval_seconds
        FROM dictionary_jobs j JOIN collection_schedule_settings s ON j.key = s.key
        JOIN dictionary_worker w ON w.id = 1 AND w.token = j.worker_token
        WHERE j.id = ? AND j.status = 'running' AND w.token = ? AND w.expires_at > ?`).get(id, token, now);
      if (!job) throw new Error("사전 워커 실행권 상실");
      const success = typeof outcome === "string";
      const retryAt = !success && outcome.retry && job.source === "automatic" && Number(job.enabled) && Number(job.failures) + 1 < maxFailures
        ? now + dictionaryRetryMs : undefined;
      await db.prepare(`UPDATE dictionary_jobs SET status = ?, available_at = ?, finished_at = ?, result = ?,
        failures = failures + ?, had_failure = MAX(had_failure, ?), worker_token = NULL WHERE id = ?`)
        .run(success ? "succeeded" : retryAt ? "retry_wait" : "failed", retryAt ?? 0, retryAt ? null : now,
          success ? outcome : null, Number(!success), Number(!success), id);
      // 실패한 수동 실행은 기존 자동 일정을 미루지 않는다.
      if (success || (job.source === "automatic" && !retryAt)) {
        await db.prepare(`UPDATE dictionary_schedule_state
          SET last_success_at = COALESCE(?, last_success_at), next_at = ? WHERE key = ?`)
          .run(success ? now : null, Number(job.enabled) ? now + Number(job.interval_seconds) * 1000 : null, job.key);
      }
      await db.prepare("UPDATE dictionary_worker SET token = NULL, expires_at = 0 WHERE token = ?").run(token);
      return retryAt;
    });
  }

  /**
   * 이번 워커의 재시도 중 여전히 자동 실행을 기다리는 작업만 선택한다.
   * @param ids 이번 실행에서 실패를 기록한 작업 ID.
   * @returns 가장 빠른 재시도 시각.
   */
  async function nextRetry(ids: readonly number[]) {
    if (!ids.length) return undefined;
    const row = await db.prepare(`SELECT MIN(available_at) AS next_at FROM dictionary_jobs
      WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'retry_wait'`).get(...ids);
    return row?.next_at == null ? undefined : Number(row.next_at);
  }

  /**
   * 화면이 접수한 작업의 상태와 결과를 읽는다.
   * @param ids 검증된 사전 작업 ID.
   * @returns 폴링에서 반환할 작업 상태.
   */
  async function jobs(ids: readonly number[]) {
    const rows = await db.prepare(`SELECT id,key,status,result FROM dictionary_jobs WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`).all(...ids);
    return rows.map((row) => ({ id: Number(row.id), key: row.key as DictionaryId,
      status: row.status as DictionaryJobStatus, result: row.result as DictionaryOutcome | null }));
  }

  /**
   * 24시간이 지난 무실패 성공 기록만 작은 배치로 정리한다.
   * @param dryRun 조회만 수행할지 여부.
   * @param now 보존 기간 기준 시각.
   * @returns 정리 대상 또는 삭제 건수.
   */
  async function cleanup(dryRun: boolean, now = Date.now()) {
    const cutoff = now - dayMs;
    const candidates = await db.prepare(dictionaryQueueQueries.cleanup).all(cutoff);
    if (dryRun || !candidates.length) return candidates.length;
    const result = await db.prepare(`DELETE FROM dictionary_jobs WHERE id IN (${candidates.map(() => "?").join(",")})
      AND status = 'succeeded' AND had_failure = 0 AND finished_at <= ?`).run(...candidates.map(({ id }) => id), cutoff);
    return result.rowsAffected;
  }

  return { settings, configure, enqueueManual, tick, reserve, releaseDispatch, claim, renew, finish, nextRetry, jobs, cleanup };
}
