import type { G2bDatabase } from "./database";
import type { NoticeJob, NoticeQueue, NoticeQueueInput, NoticeRun, NoticeRunPeriod } from "./notice-queue-types";

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
    return await db.prepare("SELECT manual, maintenance FROM g2b_notice_queue WHERE id = 1").get() as { manual: number; maintenance: number };
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
      await db.prepare(`UPDATE g2b_notice_jobs SET force = 1, status = 'pending', availableAt = 0,
        failures = CASE WHEN status = 'retry_wait' THEN 0 ELSE failures END, input = ? WHERE id = ?`)
        .run(JSON.stringify(merged), id);
    } else {
      id = Number((await db.prepare("INSERT INTO g2b_notice_jobs(number, revision, input, force) VALUES (?, ?, ?, ?)")
        .run(number, revision, JSON.stringify(input), 1)).lastInsertRowid);
    }
    await db.prepare("INSERT INTO g2b_notice_walk_visits VALUES (?, ?, ?, ?)").run(walk, number, revision, id);
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
      INSERT INTO g2b_notice_jobs (number, revision, input, force)
      SELECT t.number, t.revision, t.input, 0 FROM first_targets AS t
      WHERE NOT EXISTS (SELECT 1 FROM g2b_notice_jobs AS j
        WHERE j.number = t.number AND j.revision = t.revision AND j.status IN ('pending', 'retry_wait', 'running'))
      ORDER BY t.position`).run(payload, walk);

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
      UPDATE g2b_notice_jobs AS j SET input = json_patch(
        CASE WHEN json_extract(c.input, '$.lookup') IS NULL THEN j.input
          ELSE json_set(j.input, '$.lookup', json_extract(c.input, '$.lookup')) END,
        json_object(
          'title', COALESCE(NULLIF(json_extract(j.input, '$.title'), ''), json_extract(c.input, '$.title')),
          'methodCode', COALESCE(NULLIF(json_extract(j.input, '$.methodCode'), ''), json_extract(c.input, '$.methodCode'))
        )
      )
      FROM chosen AS c WHERE j.id = c.job_id AND (
        COALESCE(json_extract(c.input, '$.title'), '') <> ''
        OR COALESCE(json_extract(c.input, '$.methodCode'), '') <> ''
        OR json_extract(c.input, '$.lookup') IS NOT NULL
      )`).run(payload, walk);

    await db.prepare(`${chosen}
      INSERT INTO g2b_notice_walk_visits (walk_id, number, revision, job_id)
      SELECT ?, number, revision, job_id FROM chosen ORDER BY position`).run(payload, walk, walk);
  }

  async function markMaintenance() {
    await db.prepare("UPDATE g2b_notice_queue SET generation = generation + 1, maintenance = generation + 1 WHERE id = 1").run();
  }

  async function createWalk() {
    return Number((await db.prepare("INSERT INTO g2b_notice_walks DEFAULT VALUES").run()).lastInsertRowid);
  }

  function runNotice(row: JobRow): NoticeRun["notices"][number] {
    const { input, result, status, error } = job(row);
    const { number, revision, methodCode, title } = input;
    return { number, revision, methodCode, title: title || result?.title || "", status, error };
  }

  return {
    enqueueRun(period, requestKey) {
      return transaction(async () => {
        const existing = requestKey && (await db.prepare("SELECT id, startMinute, endMinute FROM g2b_notice_runs WHERE requestKey = ?").get(requestKey));
        if (existing) {
          if (existing.startMinute !== period.startMinute || existing.endMinute !== period.endMinute) {
            throw new RangeError("같은 요청 키로 다른 기간을 접수할 수 없습니다.");
          }
          return Number(existing.id);
        }
        return Number((await db.prepare("INSERT INTO g2b_notice_runs(startMinute, endMinute, requestKey) VALUES (?, ?, ?)")
          .run(period.startMinute, period.endMinute, requestKey ?? null)).lastInsertRowid);
      });
    },
    claimRun() {
      return transaction(async () => {
        const { manual, maintenance } = await state();
        if (manual || maintenance) return;
        return await db.prepare(`UPDATE g2b_notice_runs SET phase = 'discovering', error = NULL WHERE id = (
          SELECT id FROM g2b_notice_runs WHERE phase = 'pending' ORDER BY id LIMIT 1
        ) AND NOT EXISTS (SELECT 1 FROM g2b_notice_runs WHERE phase = 'discovering')
        RETURNING id, startMinute, endMinute`).get() as (NoticeRunPeriod & { id: number }) | undefined;
      });
    },
    finishRun(id, outcome) {
      return transaction(async () => {
        if (!await db.prepare("SELECT id FROM g2b_notice_runs WHERE id = ? AND phase = 'discovering'").get(id)) return;
        if (outcome.kind === "targets") {
          const walk = await createWalk();
          await attachRelated(walk, outcome.targets);
          await db.prepare(`UPDATE g2b_notice_runs SET phase = 'collecting', walkId = ?, error = NULL,
            initialCount = (SELECT COUNT(*) FROM g2b_notice_walk_visits WHERE walk_id = ?) WHERE id = ?`)
            .run(walk, walk, id);
        } else {
          if (outcome.kind === "maintenance") await markMaintenance();
          await db.prepare("UPDATE g2b_notice_runs SET phase = ?, error = ? WHERE id = ?")
            .run(outcome.kind === "maintenance" ? "pending" : "failed", outcome.error, id);
        }
      });
    },
    getRun(id) {
      return transaction(async () => {
        const run = await db.prepare(`SELECT id, startMinute, endMinute, phase, walkId, initialCount, error
          FROM g2b_notice_runs WHERE id = COALESCE(?, (SELECT MAX(id) FROM g2b_notice_runs))`).get(id ?? null) as
          (NoticeRunPeriod & { id: number; phase: NoticeRun["status"]; walkId: number | null; initialCount: number | null; error: string | null }) | undefined;
        if (!run) return;
        const notices = (await db.prepare(`SELECT j.* FROM g2b_notice_walk_visits v JOIN g2b_notice_jobs j ON j.id = v.job_id
          WHERE v.walk_id = ? ORDER BY v.rowid`).all(run.walkId) as JobRow[]).map(runNotice);
        const succeededCount = notices.filter(({ status }) => status === "succeeded").length;
        const failedCount = notices.filter(({ status }) => status === "failed").length;
        const status = run.phase === "collecting" && succeededCount + failedCount === notices.length ? "completed" : run.phase;
        const { manual, maintenance } = await state();
        const pauseReason = status === "completed" || status === "failed" ? null :
          maintenance ? "maintenance" : manual ? "manual" : null;
        return { id: run.id, startMinute: run.startMinute, endMinute: run.endMinute, status, pauseReason,
          initialCount: run.initialCount, totalCount: notices.length, succeededCount, failedCount, error: run.error, notices };
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
    async hasActiveRuns() {
      return Boolean(await db.prepare(`SELECT 1 FROM g2b_notice_runs r WHERE r.phase IN ('pending', 'discovering')
        OR EXISTS (SELECT 1 FROM g2b_notice_walk_visits v JOIN g2b_notice_jobs j ON j.id = v.job_id
          WHERE v.walk_id = r.walkId AND j.status IN ('pending', 'running', 'retry_wait')) LIMIT 1`).get());
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
    claim(now) {
      return transaction(async () => {
        const { manual, maintenance } = await state();
        if (manual || maintenance) return;
        const row = await db.prepare(`
          UPDATE g2b_notice_jobs SET status = 'running', executions = executions + 1 WHERE id = (
            SELECT id FROM g2b_notice_jobs WHERE status IN ('pending', 'retry_wait') AND availableAt <= ?
            AND NOT EXISTS (SELECT 1 FROM g2b_notice_jobs WHERE status = 'running')
            ORDER BY force DESC, id LIMIT 1
          ) RETURNING *
        `).get(now) as JobRow | undefined;
        return row && job(row);
      });
    },
    finish(id, outcome, now, attempts = []) {
      return transaction(async () => {
        const current = await db.prepare("SELECT failures FROM g2b_notice_jobs WHERE id = ? AND status = 'running'").get(id);
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
        const failures = Number(current.failures) + Number(outcome.kind === "failure");
        let status: NoticeJob["status"];
        switch (outcome.kind) {
          case "success": status = "succeeded"; break;
          case "maintenance": status = "pending"; break;
          case "internal_error": status = "failed"; break;
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
        await db.prepare("UPDATE g2b_notice_jobs SET status = ?, failures = ?, availableAt = ?, error = ?, result = ? WHERE id = ?")
          .run(status, failures, status === "retry_wait" ? now + 60_000 : 0,
            outcome.kind === "success" ? null : outcome.error,
            JSON.stringify(("result" in outcome ? outcome.result : null) ?? null), id);
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
    async clearMaintenance(version) {
      await db.prepare("UPDATE g2b_notice_queue SET maintenance = 0 WHERE id = 1 AND maintenance = ?").run(version);
    },
  };
}
