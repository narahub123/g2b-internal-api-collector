import { randomUUID } from "node:crypto";
import { noticeRetryDelayMs } from "./notice-queue-types";
import type { G2bDatabase } from "./database";
import { openNoticeAutomatic } from "./notice-automatic";
import type { NoticeJob, NoticeQueue, NoticeQueueInput, NoticeRun, NoticeRunNoticePage, NoticeRunPeriod, NoticeSource } from "./notice-queue-types";

type JobRow = Omit<NoticeJob, "input" | "result" | "force"> & { input: string; result: string | null; force: number };

function job(row: JobRow): NoticeJob {
  return { ...row, force: Boolean(row.force), input: JSON.parse(row.input), result: row.result ? JSON.parse(row.result) : null };
}

/**
 * 공고 큐와 탐색 방문 기록을 업무 데이터와 같은 Turso DB에서 관리한다.
 * 외부 호출 전에 선점 트랜잭션을 끝내고 결과와 후속 등록을 한 번에 커밋한다.
 */
export function openNoticeQueue(db: G2bDatabase): NoticeQueue {
  const transaction = db.transaction.bind(db);

  async function state() {
    return await db.prepare(`SELECT q.manual, q.maintenance, (a.generation > 0 AND a.enabled = 0) AS automaticPaused
      FROM g2b_notice_queue q JOIN g2b_notice_automatic a ON a.id = q.id WHERE q.id = 1`).get() as
      { manual: number; maintenance: number; automaticPaused: number };
  }

  async function attachForced(walk: number, input: NoticeQueueInput) {
    const { number, revision } = input;
    const visited = await db.prepare("SELECT job_id FROM g2b_notice_walk_visits WHERE walk_id = ? AND number = ? AND revision = ?").get(walk, number, revision);
    if (visited) return Number(visited.job_id);
    const existing = await db.prepare(`
      SELECT * FROM g2b_notice_jobs WHERE number = ? AND revision = ?
      AND status IN ('pending', 'retry_wait')
      ORDER BY id LIMIT 1
    `).get(number, revision) as JobRow | undefined;
    let id: number;
    if (existing) {
      id = existing.id;
      const prior = job(existing).input;
      const merged = {
        ...prior, ...input, methodCode: input.methodCode || prior.methodCode,
        opening: prior.opening || input.opening,
      };
      await db.prepare(`UPDATE g2b_notice_jobs SET source = 'manual', force = 1, status = 'pending', availableAt = 0,
        failures = CASE WHEN status = 'retry_wait' THEN 0 ELSE failures END, input = ? WHERE id = ?`)
        .run(JSON.stringify(merged), id);
    } else {
      id = Number((await db.prepare("INSERT INTO g2b_notice_jobs(number, revision, input, force) VALUES (?, ?, ?, ?)")
        .run(number, revision, JSON.stringify(input), 1)).lastInsertRowid);
    }
    await db.prepare("INSERT INTO g2b_notice_walk_visits (walk_id, number, revision, job_id) VALUES (?, ?, ?, ?)").run(walk, number, revision, id);
    return id;
  }

  // 기간 탐색은 여러 페이지를 한꺼번에 등록한다. 각 공고마다 원격 왕복을 반복하면 쓰기 잠금이 길어진다.
  const incoming = `
    WITH incoming AS MATERIALIZED (
      SELECT CAST(key AS INTEGER) AS position, value AS input,
        json_extract(value, '$.number') AS number, json_extract(value, '$.revision') AS revision
      FROM json_each(?)
    ),
    first_targets AS MATERIALIZED (
      SELECT item.* FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY number, revision ORDER BY position) AS occurrence
        FROM incoming
      ) AS item
      WHERE occurrence = 1 AND NOT EXISTS (SELECT 1 FROM g2b_notice_walk_visits AS v
          WHERE v.walk_id = ? AND v.number = item.number AND v.revision = item.revision)
    )`;

  async function attachRelated(walk: number, inputs: NoticeQueueInput[]) {
    if (!inputs.length) return;
    const payload = JSON.stringify(inputs);
    await db.prepare(`${incoming}
      INSERT INTO g2b_notice_jobs (number, revision, input, force, source)
      SELECT t.number, t.revision, t.input, 0, w.source
      FROM first_targets AS t CROSS JOIN g2b_notice_walks AS w
      WHERE w.id = ?
      AND NOT EXISTS (SELECT 1 FROM g2b_notice_jobs AS j
        WHERE j.number = t.number AND j.revision = t.revision AND j.status IN ('pending', 'retry_wait', 'running'))
      ORDER BY t.position`).run(payload, walk, walk);

    const chosen = `${incoming},
      chosen AS MATERIALIZED (
        SELECT t.position, t.number, t.revision, t.input,
          (SELECT j.id FROM g2b_notice_jobs AS j
            WHERE j.number = t.number AND j.revision = t.revision AND j.status IN ('pending', 'retry_wait', 'running')
            ORDER BY j.status = 'running' DESC, j.id LIMIT 1) AS job_id
        FROM first_targets AS t
      )`;
    // 일반 등록은 실행 중인 작업을 우선 재사용하고 부족한 제목·방법 코드만 보완한다.
    await db.prepare(`${chosen}
      UPDATE g2b_notice_jobs AS j SET input = CASE WHEN
        COALESCE(json_extract(c.input, '$.title'), '') <> ''
        OR COALESCE(json_extract(c.input, '$.methodCode'), '') <> ''
        OR json_extract(c.input, '$.lookup') IS NOT NULL
      THEN json_patch(
        CASE WHEN json_extract(c.input, '$.lookup') IS NULL THEN j.input
          ELSE json_set(j.input, '$.lookup', json_extract(c.input, '$.lookup')) END,
        json_object(
          'title', COALESCE(NULLIF(json_extract(j.input, '$.title'), ''), json_extract(c.input, '$.title')),
          'methodCode', COALESCE(NULLIF(json_extract(j.input, '$.methodCode'), ''), json_extract(c.input, '$.methodCode'))
        )
      ) ELSE j.input END, source = CASE WHEN w.source = 'manual' THEN 'manual' ELSE j.source END
      FROM chosen AS c CROSS JOIN g2b_notice_walks AS w
      WHERE j.id = c.job_id AND w.id = ?`).run(payload, walk, walk);

    await db.prepare(`${chosen}
      INSERT INTO g2b_notice_walk_visits (walk_id, number, revision, job_id)
      SELECT ?, number, revision, job_id FROM chosen ORDER BY position`).run(payload, walk, walk);
  }

  async function markMaintenance() {
    await db.prepare("UPDATE g2b_notice_queue SET generation = generation + 1, maintenance = generation + 1 WHERE id = 1").run();
  }

  async function createWalk(source: NoticeSource = "manual") {
    return Number((await db.prepare("INSERT INTO g2b_notice_walks (source) VALUES (?)").run(source)).lastInsertRowid);
  }

  // 최초 상세 결과가 재시도 대기 상태로 저장되어도 구간 완료 조건을 충족한다.
  async function recordCoverage(walk: number, now: number) {
    await db.prepare(`UPDATE g2b_notice_runs SET coveredThrough = endMinute, scheduleFinishedAt = ?
      WHERE walkId = ? AND source = 'automatic' AND phase = 'collecting' AND coveredThrough IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM g2b_notice_walk_visits v JOIN g2b_notice_jobs j ON j.id = v.job_id
        WHERE v.walk_id = g2b_notice_runs.walkId AND v.initialTarget = 1 AND j.hasFirstResult = 0
      )`).run(now, walk);
  }

  function runNotice(row: JobRow): NoticeRun["notices"][number] {
    const { input, result, status, error } = job(row);
    const { number, revision, methodCode, title } = input;
    return { number, revision, methodCode, title: title || result?.title || "", status, error };
  }

  const queue: NoticeQueue = {
    automatic: openNoticeAutomatic(db),
    async reserveWorkerDispatch(now) {
      const token = randomUUID();
      // 예약·실행권 검사는 같은 UPDATE에서 판단해 여러 웹 인스턴스의 호출이 겹치지 않게 한다.
      const result = await db.prepare(`
        UPDATE g2b_notice_queue AS q SET dispatchToken = ?, dispatchUntil = unixepoch() + 180
        WHERE q.id = 1 AND q.dispatchUntil <= unixepoch()
          AND NOT EXISTS (SELECT 1 FROM g2b_notice_worker_lease WHERE token IS NOT NULL AND expires_at > unixepoch())
          AND EXISTS (
            SELECT 1 FROM g2b_notice_automatic a WHERE a.id = 1 AND (
              (a.enabled = 1 AND a.nextAt <= ? AND (q.manual = 0 OR q.maintenance <> 0))
              OR (a.enabled = 1 AND q.maintenance <> 0 AND a.probeMaintenance = q.maintenance)
              OR (q.manual = 0 AND (
                (a.enabled = 1 AND a.immediate = 1 AND q.maintenance = 0)
                OR ((q.maintenance = 0 OR a.enabled = 0) AND (
                  EXISTS (SELECT 1 FROM g2b_notice_runs r
                    WHERE r.phase IN ('pending', 'discovering') AND (r.source = 'manual' OR a.enabled = 1))
                  OR EXISTS (SELECT 1 FROM g2b_notice_jobs j
                    WHERE j.status IN ('pending', 'retry_wait', 'running') AND j.availableAt <= ?
                    AND (j.source = 'manual' OR a.enabled = 1))
                ))
              ))
            )
          )
      `).run(token, now, now);
      return result.rowsAffected === 1 ? token : undefined;
    },
    async releaseWorkerDispatch(token) {
      await db.prepare(`UPDATE g2b_notice_queue SET dispatchToken = NULL, dispatchUntil = 0
        WHERE id = 1 AND (? IS NULL OR dispatchToken = ?)`).run(token ?? null, token ?? null);
    },
    async nextRetryAt() {
      const row = await db.prepare(`SELECT MIN(j.availableAt) AS readyAt
        FROM g2b_notice_jobs j CROSS JOIN g2b_notice_queue q CROSS JOIN g2b_notice_automatic a
        WHERE q.id = 1 AND a.id = 1 AND q.manual = 0 AND q.maintenance = 0
          AND j.status = 'retry_wait' AND (j.source = 'manual' OR a.enabled = 1)`).get();
      return typeof row?.readyAt === "number" ? row.readyAt : null;
    },
    enqueueRun(period, requestKey, source = "manual") {
      return transaction(async () => {
        const existing = requestKey && (await db.prepare("SELECT id, startMinute, endMinute, source FROM g2b_notice_runs WHERE requestKey = ?").get(requestKey));
        if (existing) {
          if (existing.startMinute !== period.startMinute || existing.endMinute !== period.endMinute || existing.source !== source) {
            throw new RangeError("같은 요청 키로 기간 또는 출처가 다른 수집을 접수할 수 없습니다.");
          }
          return Number(existing.id);
        }
        return Number((await db.prepare("INSERT INTO g2b_notice_runs(startMinute, endMinute, requestKey, source) VALUES (?, ?, ?, ?)")
          .run(period.startMinute, period.endMinute, requestKey ?? null, source)).lastInsertRowid);
      });
    },
    claimRun(source) {
      return transaction(async () => {
        const { manual, maintenance, automaticPaused } = await state();
        if (manual || maintenance) return;
        return await db.prepare(`UPDATE g2b_notice_runs SET phase = 'discovering', error = NULL WHERE id = (
          SELECT id FROM g2b_notice_runs WHERE phase = 'pending' AND (? IS NULL OR source = ?)
          AND (? = 0 OR source = 'manual')
          ORDER BY source = 'manual' DESC, id LIMIT 1
        ) AND NOT EXISTS (SELECT 1 FROM g2b_notice_runs WHERE phase = 'discovering')
          AND NOT EXISTS (SELECT 1 FROM g2b_notice_jobs WHERE status = 'running')
        RETURNING id, startMinute, endMinute`).get(source ?? null, source ?? null, automaticPaused) as
          (NoticeRunPeriod & { id: number }) | undefined;
      });
    },
    async getAutomaticCoveredThrough() {
      const row = await db.prepare("SELECT MAX(coveredThrough) AS coveredThrough FROM g2b_notice_runs WHERE source = 'automatic'").get();
      return (row?.coveredThrough as string | null | undefined) ?? null;
    },
    finishRun(id, outcome, now = Date.now()) {
      return transaction(async () => {
        const run = await db.prepare("SELECT source FROM g2b_notice_runs WHERE id = ? AND phase = 'discovering'").get(id);
        if (!run) return;
        if (outcome.kind === "targets") {
          const walk = await createWalk(run.source as NoticeSource);
          await attachRelated(walk, outcome.targets);
          if (run.source === "automatic") {
            await db.prepare("UPDATE g2b_notice_walk_visits SET initialTarget = 1 WHERE walk_id = ?").run(walk);
          }
          await db.prepare(`UPDATE g2b_notice_runs SET phase = 'collecting', walkId = ?, error = NULL,
            initialCount = (SELECT COUNT(*) FROM g2b_notice_walk_visits WHERE walk_id = ?) WHERE id = ?`)
            .run(walk, walk, id);
          if (run.source === "automatic") await recordCoverage(walk, now);
        } else {
          if (outcome.kind === "maintenance") await markMaintenance();
          await db.prepare("UPDATE g2b_notice_runs SET phase = ?, error = ?, scheduleFinishedAt = ? WHERE id = ?")
            .run(outcome.kind === "maintenance" ? "pending" : "failed", outcome.error, outcome.kind === "failure" ? now : null, id);
        }
      });
    },
    getRun(id) {
      return transaction(async () => {
        const run = await db.prepare(`SELECT id, startMinute, endMinute, source, phase, walkId, initialCount, error
          FROM g2b_notice_runs WHERE id = COALESCE(?, (SELECT MAX(id) FROM g2b_notice_runs WHERE source = 'manual'))`).get(id ?? null) as
          (NoticeRunPeriod & { id: number; source: NoticeSource; phase: NoticeRun["status"]; walkId: number | null; initialCount: number | null; error: string | null }) | undefined;
        if (!run) return;
        const notices = (await db.prepare(`SELECT j.* FROM g2b_notice_walk_visits v JOIN g2b_notice_jobs j ON j.id = v.job_id
          WHERE v.walk_id = ? ORDER BY v.rowid`).all(run.walkId) as JobRow[]).map(runNotice);
        const succeededCount = notices.filter(({ status }) => status === "succeeded").length;
        const failedCount = notices.filter(({ status }) => status === "failed").length;
        const status = run.phase === "collecting" && succeededCount + failedCount === notices.length ? "completed" : run.phase;
        const { manual, maintenance, automaticPaused } = await state();
        const pauseReason = status === "completed" || status === "failed" ? null :
          maintenance ? "maintenance" : manual ? "manual" : automaticPaused && run.source === "automatic" ? "automatic" : null;
        return { id: run.id, startMinute: run.startMinute, endMinute: run.endMinute, status, pauseReason,
          initialCount: run.initialCount, totalCount: notices.length, succeededCount, failedCount, error: run.error, notices };
      }, false);
    },
    getRunSummary(id) {
      return transaction(async () => {
        const row = await db.prepare(`
          SELECT r.id, r.startMinute, r.endMinute, r.phase, r.initialCount, r.error,
            COALESCE(c.total, 0) AS totalCount, COALESCE(c.completed, 0) AS succeededCount,
            COALESCE(c.failed, 0) AS failedCount, q.manual, q.maintenance
          FROM g2b_notice_runs r CROSS JOIN g2b_notice_queue q
          LEFT JOIN g2b_notice_period_counts c ON c.walk_id = r.walkId
          WHERE q.id = 1 AND r.source = 'manual' AND r.id = COALESCE(?, (
            SELECT id FROM g2b_notice_runs INDEXED BY g2b_notice_manual_runs
            WHERE source = 'manual' ORDER BY id DESC LIMIT 1
          ))`).get(id ?? null) as (NoticeRunPeriod & {
            id: number; phase: NoticeRun["status"]; initialCount: number | null; error: string | null;
            totalCount: number; succeededCount: number; failedCount: number; manual: number; maintenance: number;
          }) | undefined;
        if (!row) return;
        const { phase, manual, maintenance, ...summary } = row;
        const status = phase === "collecting" && summary.succeededCount + summary.failedCount === summary.totalCount
          ? "completed" : phase;
        const pauseReason = status === "completed" || status === "failed" ? null
          : maintenance ? "maintenance" : manual ? "manual" : null;
        return { ...summary, status, pauseReason };
      }, false);
    },
    listRunNotices(id, kind, cursor) {
      return transaction(async () => {
        const run = await db.prepare("SELECT walkId FROM g2b_notice_runs WHERE id = ? AND source = 'manual'").get(id);
        if (!run) return;
        const walkId = run.walkId;
        async function readPage(boundary?: typeof cursor) {
          const reverse = boundary?.direction === "before";
          const order = reverse ? "DESC" : "ASC";
          const range = boundary ? (reverse ? "AND v.rowid < ?" : "AND v.rowid > ?") : "";
          const index = kind === "failed" ? "g2b_notice_period_failed" : "g2b_notice_period_visits";
          const filter = kind === "failed" ? "AND v.periodStatus = 'failed'" : "";
          // 방문 인덱스에서 21건으로 제한하고, 해당 작업만 기본 키로 읽는다.
          const rows = await db.prepare(`
            SELECT v.rowid AS visitId, j.* FROM g2b_notice_walk_visits v INDEXED BY ${index}
            CROSS JOIN g2b_notice_jobs j ON j.id = v.job_id
            WHERE v.walk_id = ? ${filter} ${range} ORDER BY v.rowid ${order} LIMIT 21
          `).all(walkId, ...(boundary ? [boundary.visitId] : [])) as (JobRow & { visitId: number })[];
          const items = rows.slice(0, 20).map((row) => ({ ...runNotice(row), id: row.visitId }));
          if (reverse) items.reverse();
          return { items, more: rows.length > 20 };
        }
        let { items, more } = await readPage(cursor);
        const boundary = items.length ? cursor : undefined;
        if (!items.length && cursor) ({ items, more } = await readPage(undefined));
        const first = items[0];
        const last = items.at(-1);
        const previous: NoticeRunNoticePage["previous"] = first && (boundary?.direction === "before" ? more : boundary)
          ? { direction: "before", visitId: first.id } : null;
        const next: NoticeRunNoticePage["next"] = last && (boundary?.direction === "before" || more)
          ? { direction: "after", visitId: last.id } : null;
        return { items, previous, next, resetCursor: Boolean(cursor && !previous) };
      }, false);
    },
    async findRunNotice(number, revision) {
      const row = await db.prepare(`SELECT j.* FROM g2b_notice_jobs j
        JOIN g2b_notice_walk_visits v ON v.job_id = j.id
        JOIN g2b_notice_runs r ON r.walkId = v.walk_id
        WHERE v.number = ? AND v.revision = ? ORDER BY r.id DESC LIMIT 1`)
        .get(number, revision) as JobRow | undefined;
      return row && runNotice(row);
    },
    async needsManualMaintenanceCheck() {
      return Boolean(await db.prepare(`SELECT 1
        FROM g2b_notice_automatic a JOIN g2b_notice_queue q ON q.id = a.id
        WHERE a.id = 1 AND a.enabled = 0 AND q.maintenance <> 0 AND (
          EXISTS (SELECT 1 FROM g2b_notice_runs WHERE source = 'manual' AND phase IN ('pending', 'discovering'))
          OR EXISTS (SELECT 1 FROM g2b_notice_jobs WHERE source = 'manual' AND status IN ('pending', 'retry_wait'))
        )`).get());
    },
    enqueue(inputs, force, retryAttemptId) {
      return transaction(async () => {
        if (!inputs.length) return [];
        if (retryAttemptId !== undefined) {
          const { number, revision } = inputs[0];
          // 이력 검증부터 접수까지 쓰기 잠금 안에서 처리해 워커의 새 시도와 경합하지 않게 한다.
          const latest = await db.prepare(`SELECT id, status FROM g2b_collection_attempts
            WHERE section = 'notices' AND number = ? AND revision = ? ORDER BY id DESC LIMIT 1`).get(number, revision);
          if (latest?.id !== retryAttemptId || latest.status === "succeeded") return [];
        }
        const walk = await createWalk();
        if (!force) {
          await attachRelated(walk, inputs);
          const rows = await db.prepare("SELECT number, revision, job_id FROM g2b_notice_walk_visits WHERE walk_id = ?").all(walk);
          const ids = new Map(rows.map((row) => [JSON.stringify([row.number, row.revision]), Number(row.job_id)]));
          return inputs.map(({ number, revision }) => ids.get(JSON.stringify([number, revision]))!);
        }
        const ids: number[] = [];
        for (const input of inputs) ids.push(await attachForced(walk, input));
        return ids;
      });
    },
    claim(now, priority) {
      return transaction(async () => {
        const { manual, maintenance, automaticPaused } = await state();
        if (manual || maintenance) return;
        const row = await db.prepare(`
          UPDATE g2b_notice_jobs SET status = 'running', executions = executions + 1 WHERE id = (
            SELECT id FROM g2b_notice_jobs WHERE status IN ('pending', 'retry_wait') AND availableAt <= ?
            AND (? = 0 OR source = 'manual')
            AND NOT EXISTS (SELECT 1 FROM g2b_notice_jobs WHERE status = 'running')
            AND NOT EXISTS (SELECT 1 FROM g2b_notice_runs WHERE phase = 'discovering')
            AND (? IS NULL OR (? = 'manual' AND source = 'manual') OR (? = 'retry' AND failures > 0))
            ORDER BY source = 'manual' DESC, (source = 'automatic' AND failures > 0) DESC, id LIMIT 1
          ) RETURNING *
        `).get(now, automaticPaused, priority ?? null, priority ?? null, priority ?? null) as JobRow | undefined;
        return row && job(row);
      });
    },
    claimNext(now, preferRun) {
      return transaction(async () => {
        const manualJob = await queue.claim(now, "manual");
        if (manualJob) return { kind: "job", job: manualJob };
        const manualRun = await queue.claimRun("manual");
        if (manualRun) return { kind: "run", run: manualRun };
        const retry = await queue.claim(now, "retry");
        if (retry) return { kind: "job", job: retry };

        // 자동 목록 탐색이 연이어 접수되어도 준비된 상세 작업에 실행 기회를 준다.
        if (preferRun) {
          const run = await queue.claimRun("automatic");
          if (run) return { kind: "run", run };
        }
        const job = await queue.claim(now);
        if (job) return { kind: "job", job };
        if (!preferRun) {
          const run = await queue.claimRun("automatic");
          if (run) return { kind: "run", run };
        }
      });
    },
    finish(id, outcome, now, attempts = []) {
      return transaction(async () => {
        const current = await db.prepare("SELECT failures, source FROM g2b_notice_jobs WHERE id = ? AND status = 'running'").get(id);
        if (!current) return;
        if (attempts.length) {
          const finishAttempt = db.prepare(`UPDATE g2b_collection_attempts
            SET status = ?, finished_at = ?, error = ?, diagnostics = ?
            WHERE id = ? AND job_id = ? AND status = 'pending'`);
          for (const attempt of attempts) {
            await finishAttempt.run(attempt.status, attempt.finishedAt, attempt.error,
              attempt.diagnostics ? JSON.stringify(attempt.diagnostics) : null, attempt.id, id);
          }
        }
        const retryable = outcome.kind === "failure" || (outcome.kind === "internal_error" && current.source === "automatic");
        const failures = Number(current.failures) + Number(retryable);
        let status: NoticeJob["status"];
        switch (outcome.kind) {
          case "success": status = "succeeded"; break;
          case "maintenance": status = "pending"; break;
          case "internal_error": status = retryable && failures < 3 ? "retry_wait" : "failed"; break;
          case "failure": status = failures >= 3 ? "failed" : "retry_wait"; break;
        }
        if (outcome.kind === "maintenance") await markMaintenance();
        if (outcome.kind === "internal_error" || outcome.kind === "maintenance") {
          // 실행기가 종료하지 못한 시도만 정리하고 이전 진단과 완료 이력을 보존한다.
          await db.prepare(`UPDATE g2b_collection_attempts SET status = ?, finished_at = ?, error = ?
            WHERE status = 'pending' AND job_id = ?`)
            .run(outcome.kind === "maintenance" ? "deferred" : "failed", new Date(now).toISOString(), outcome.error, id);
        }
        if (outcome.kind === "success" || outcome.kind === "failure") {
          const walks = await db.prepare("SELECT walk_id FROM g2b_notice_walk_visits WHERE job_id = ?").all(id);
          for (const { walk_id } of walks) {
            await attachRelated(Number(walk_id), outcome.related ?? []);
          }
        }
        // 종료 시 이미 예약된 강제 작업이 있으면 현재 작업은 일반 재시도 규칙을 그대로 따른다.
        await db.prepare(`UPDATE g2b_notice_jobs SET status = ?, failures = ?, availableAt = ?, error = ?, result = ?,
          hasFirstResult = MAX(hasFirstResult, ?) WHERE id = ?`)
          .run(status, failures, status === "retry_wait" ? now + noticeRetryDelayMs : 0,
            outcome.kind === "success" ? null : outcome.error,
            JSON.stringify(("result" in outcome ? outcome.result : null) ?? null), Number(outcome.kind !== "maintenance"), id);
        if (outcome.kind !== "maintenance") {
          const initialWalks = await db.prepare("SELECT walk_id FROM g2b_notice_walk_visits WHERE job_id = ? AND initialTarget = 1").all(id);
          for (const { walk_id } of initialWalks) await recordCoverage(Number(walk_id), now);
        }
      });
    },
    recover() {
      return transaction(async () => {
        await db.prepare(`UPDATE g2b_collection_attempts SET status = 'deferred', finished_at = ?, error = ?
          WHERE status = 'pending' AND job_id IN (SELECT id FROM g2b_notice_jobs WHERE status = 'running')`)
          .run(new Date().toISOString(), "워커 종료로 수집이 중단되었습니다.");
        await db.prepare(`UPDATE g2b_collection_attempts SET status = 'deferred', finished_at = ?, error = ?
          WHERE status = 'pending' AND job_id IN (SELECT id FROM g2b_notice_jobs WHERE status <> 'running')`)
          .run(new Date().toISOString(), "수집 시도의 종료 결과를 확인할 수 없습니다.");
        await db.prepare("UPDATE g2b_notice_jobs SET status = 'pending', availableAt = 0 WHERE status = 'running'").run();
        await db.prepare("UPDATE g2b_notice_runs SET phase = 'pending' WHERE phase = 'discovering'").run();
      });
    },
    async get(id) {
      const row = await db.prepare("SELECT * FROM g2b_notice_jobs WHERE id = ?").get(id) as JobRow | undefined;
      return row && job(row);
    },
    async overview() {
      const { manual, maintenance } = await state();
      const jobs = await db.prepare("SELECT * FROM g2b_notice_jobs ORDER BY status = 'running' DESC, id DESC LIMIT 50").all() as JobRow[];
      return { manual: Boolean(manual), maintenance, active: jobs.find(({ status }) => status === "running")?.id ?? null, jobs: jobs.map(job) };
    },
    async maintenanceVersion() {
      return (await state()).maintenance;
    },
    async setManual(paused) {
      await db.prepare("UPDATE g2b_notice_queue SET manual = ? WHERE id = 1").run(Number(paused));
    },
    markMaintenance,
    async clearMaintenance(version, scheduleGeneration) {
      await db.prepare(`UPDATE g2b_notice_queue SET maintenance = 0 WHERE id = 1 AND maintenance = ?
        AND EXISTS (SELECT 1 FROM g2b_notice_automatic
          WHERE (? IS NULL AND enabled = 0) OR (enabled = 1 AND generation = ?))`)
        .run(version, scheduleGeneration ?? null, scheduleGeneration ?? null);
    },
  };
  return queue;
}
