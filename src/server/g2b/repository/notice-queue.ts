import type { DatabaseSync } from "node:sqlite";
import type { NoticeJob, NoticeQueue, NoticeQueueInput, NoticeRun, NoticeRunPeriod } from "./notice-queue-types";

type JobRow = Omit<NoticeJob, "input" | "result" | "force"> & { input: string; result: string | null; force: number };

function job(row: JobRow): NoticeJob {
  return { ...row, force: Boolean(row.force), input: JSON.parse(row.input), result: row.result ? JSON.parse(row.result) : null };
}

/**
 * 공고 큐와 탐색 방문 기록을 업무 데이터와 같은 SQLite 파일에서 관리한다.
 * 외부 호출 전에 선점 트랜잭션을 끝내고 결과와 후속 등록을 한 번에 커밋한다.
 */
export function openNoticeQueue(db: DatabaseSync): NoticeQueue {
  db.exec(`
    CREATE TABLE IF NOT EXISTS g2b_notice_queue (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      manual INTEGER NOT NULL DEFAULT 0,
      maintenance INTEGER NOT NULL DEFAULT 0,
      generation INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO g2b_notice_queue (id) VALUES (1);
    CREATE TABLE IF NOT EXISTS g2b_notice_jobs (
      id INTEGER PRIMARY KEY,
      number TEXT NOT NULL,
      revision TEXT NOT NULL,
      input TEXT NOT NULL,
      force INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      failures INTEGER NOT NULL DEFAULT 0,
      executions INTEGER NOT NULL DEFAULT 0,
      availableAt INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      result TEXT
    );
    CREATE INDEX IF NOT EXISTS g2b_notice_jobs_target ON g2b_notice_jobs(number, revision, status);
    CREATE INDEX IF NOT EXISTS g2b_notice_jobs_ready ON g2b_notice_jobs(status, force DESC, id);
    CREATE UNIQUE INDEX IF NOT EXISTS g2b_notice_jobs_running ON g2b_notice_jobs(status) WHERE status = 'running';
    CREATE TABLE IF NOT EXISTS g2b_notice_walks (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS g2b_notice_walk_visits (
      walk_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      revision TEXT NOT NULL,
      job_id INTEGER NOT NULL,
      PRIMARY KEY(walk_id, number, revision)
    );
    CREATE INDEX IF NOT EXISTS g2b_notice_walk_jobs ON g2b_notice_walk_visits(job_id);
    CREATE TABLE IF NOT EXISTS g2b_notice_runs (
      id INTEGER PRIMARY KEY,
      startMinute TEXT NOT NULL,
      endMinute TEXT NOT NULL,
      requestKey TEXT UNIQUE,
      phase TEXT NOT NULL DEFAULT 'pending',
      walkId INTEGER REFERENCES g2b_notice_walks(id),
      initialCount INTEGER,
      error TEXT
    );
  `);

  function transaction<T>(run: () => T, write = true): T {
    db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try {
      const result = run();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  // 기존 개발 DB에 이미 초기 큐 스키마가 있으면 실행 횟수 열을 보충한다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('g2b_notice_jobs') WHERE name = 'executions'").get()) {
    transaction(() => {
      if (!db.prepare("SELECT 1 FROM pragma_table_info('g2b_notice_jobs') WHERE name = 'executions'").get()) {
        db.exec("ALTER TABLE g2b_notice_jobs ADD COLUMN executions INTEGER NOT NULL DEFAULT 0");
      }
    });
  }

  function state() {
    return db.prepare("SELECT manual, maintenance FROM g2b_notice_queue WHERE id = 1").get() as { manual: number; maintenance: number };
  }

  function attach(walk: number, input: NoticeQueueInput, force: boolean) {
    const { number, revision } = input;
    const visited = db.prepare("SELECT job_id FROM g2b_notice_walk_visits WHERE walk_id = ? AND number = ? AND revision = ?").get(walk, number, revision);
    if (visited) return Number(visited.job_id);
    const existing = db.prepare(`
      SELECT * FROM g2b_notice_jobs WHERE number = ? AND revision = ?
      AND status IN ('pending', 'retry_wait', 'running') AND (? = 0 OR status <> 'running')
      ORDER BY status = 'running' DESC, id LIMIT 1
    `).get(number, revision, Number(force)) as JobRow | undefined;
    let id: number;
    if (existing) {
      id = existing.id;
      if (force) {
        const prior = job(existing).input;
        const merged = {
          ...prior, ...input, methodCode: input.methodCode || prior.methodCode,
          opening: prior.opening || input.opening,
        };
        db.prepare(`UPDATE g2b_notice_jobs SET force = 1, status = 'pending', availableAt = 0,
          failures = CASE WHEN status = 'retry_wait' THEN 0 ELSE failures END, input = ? WHERE id = ?`)
          .run(JSON.stringify(merged), id);
      } else if (input.title || input.methodCode) {
        const prior = job(existing).input;
        const title = prior.title || input.title;
        const methodCode = prior.methodCode || input.methodCode;
        if (title !== prior.title || methodCode !== prior.methodCode) {
          db.prepare("UPDATE g2b_notice_jobs SET input = ? WHERE id = ?")
            .run(JSON.stringify({ ...prior, title, methodCode }), id);
        }
      }
    } else {
      id = Number(db.prepare("INSERT INTO g2b_notice_jobs(number, revision, input, force) VALUES (?, ?, ?, ?)")
        .run(number, revision, JSON.stringify(input), Number(force)).lastInsertRowid);
    }
    db.prepare("INSERT INTO g2b_notice_walk_visits VALUES (?, ?, ?, ?)").run(walk, number, revision, id);
    return id;
  }

  function markMaintenance() {
    db.exec("UPDATE g2b_notice_queue SET generation = generation + 1, maintenance = generation + 1 WHERE id = 1");
  }

  function createWalk() {
    return Number(db.prepare("INSERT INTO g2b_notice_walks DEFAULT VALUES").run().lastInsertRowid);
  }

  function runNotice(row: JobRow): NoticeRun["notices"][number] {
    const { input, result, status, error } = job(row);
    const { number, revision, methodCode, title } = input;
    return { number, revision, methodCode, title: title || result?.title || "", status, error };
  }

  return {
    enqueueRun(period, requestKey) {
      return transaction(() => {
        const existing = requestKey && db.prepare("SELECT id, startMinute, endMinute FROM g2b_notice_runs WHERE requestKey = ?").get(requestKey);
        if (existing) {
          if (existing.startMinute !== period.startMinute || existing.endMinute !== period.endMinute) {
            throw new RangeError("같은 요청 키로 다른 기간을 접수할 수 없습니다.");
          }
          return Number(existing.id);
        }
        return Number(db.prepare("INSERT INTO g2b_notice_runs(startMinute, endMinute, requestKey) VALUES (?, ?, ?)")
          .run(period.startMinute, period.endMinute, requestKey ?? null).lastInsertRowid);
      });
    },
    claimRun() {
      return transaction(() => {
        const { manual, maintenance } = state();
        if (manual || maintenance) return;
        return db.prepare(`UPDATE g2b_notice_runs SET phase = 'discovering', error = NULL WHERE id = (
          SELECT id FROM g2b_notice_runs WHERE phase = 'pending' ORDER BY id LIMIT 1
        ) AND NOT EXISTS (SELECT 1 FROM g2b_notice_runs WHERE phase = 'discovering')
        RETURNING id, startMinute, endMinute`).get() as (NoticeRunPeriod & { id: number }) | undefined;
      });
    },
    finishRun(id, outcome) {
      transaction(() => {
        if (!db.prepare("SELECT id FROM g2b_notice_runs WHERE id = ? AND phase = 'discovering'").get(id)) return;
        if (outcome.kind === "targets") {
          const walk = createWalk();
          for (const target of outcome.targets) attach(walk, target, false);
          db.prepare(`UPDATE g2b_notice_runs SET phase = 'collecting', walkId = ?, error = NULL,
            initialCount = (SELECT COUNT(*) FROM g2b_notice_walk_visits WHERE walk_id = ?) WHERE id = ?`)
            .run(walk, walk, id);
        } else {
          if (outcome.kind === "maintenance") markMaintenance();
          db.prepare("UPDATE g2b_notice_runs SET phase = ?, error = ? WHERE id = ?")
            .run(outcome.kind === "maintenance" ? "pending" : "failed", outcome.error, id);
        }
      });
    },
    getRun(id) {
      return transaction(() => {
        const run = db.prepare(`SELECT id, startMinute, endMinute, phase, walkId, initialCount, error
          FROM g2b_notice_runs WHERE id = COALESCE(?, (SELECT MAX(id) FROM g2b_notice_runs))`).get(id ?? null) as
          (NoticeRunPeriod & { id: number; phase: NoticeRun["status"]; walkId: number | null; initialCount: number | null; error: string | null }) | undefined;
        if (!run) return;
        const notices = (db.prepare(`SELECT j.* FROM g2b_notice_walk_visits v JOIN g2b_notice_jobs j ON j.id = v.job_id
          WHERE v.walk_id = ? ORDER BY v.rowid`).all(run.walkId) as JobRow[]).map(runNotice);
        const succeededCount = notices.filter(({ status }) => status === "succeeded").length;
        const failedCount = notices.filter(({ status }) => status === "failed").length;
        const status = run.phase === "collecting" && succeededCount + failedCount === notices.length ? "completed" : run.phase;
        const { manual, maintenance } = state();
        const pauseReason = status === "completed" || status === "failed" ? null :
          maintenance ? "maintenance" : manual ? "manual" : null;
        return { id: run.id, startMinute: run.startMinute, endMinute: run.endMinute, status, pauseReason,
          initialCount: run.initialCount, totalCount: notices.length, succeededCount, failedCount, error: run.error, notices };
      }, false);
    },
    findRunNotice(number, revision) {
      const row = db.prepare(`SELECT j.* FROM g2b_notice_jobs j
        JOIN g2b_notice_walk_visits v ON v.job_id = j.id
        JOIN g2b_notice_runs r ON r.walkId = v.walk_id
        WHERE v.number = ? AND v.revision = ? ORDER BY r.id DESC LIMIT 1`)
        .get(number, revision) as JobRow | undefined;
      return row && runNotice(row);
    },
    hasActiveRuns() {
      return Boolean(db.prepare(`SELECT 1 FROM g2b_notice_runs r WHERE r.phase IN ('pending', 'discovering')
        OR EXISTS (SELECT 1 FROM g2b_notice_walk_visits v JOIN g2b_notice_jobs j ON j.id = v.job_id
          WHERE v.walk_id = r.walkId AND j.status IN ('pending', 'running', 'retry_wait')) LIMIT 1`).get());
    },
    enqueue(inputs, force, retryAttemptId) {
      return transaction(() => {
        if (!inputs.length) return [];
        if (retryAttemptId !== undefined) {
          const { number, revision } = inputs[0];
          // 이력 검증부터 접수까지 쓰기 잠금 안에서 처리해 워커의 새 시도와 경합하지 않게 한다.
          const latest = db.prepare(`SELECT id, status FROM g2b_collection_attempts
            WHERE section = 'notices' AND number = ? AND revision = ? ORDER BY id DESC LIMIT 1`).get(number, revision);
          if (latest?.id !== retryAttemptId || latest.status === "succeeded") return [];
        }
        const walk = createWalk();
        return inputs.map((input) => attach(walk, input, force));
      });
    },
    claim(now) {
      return transaction(() => {
        const { manual, maintenance } = state();
        if (manual || maintenance) return;
        const row = db.prepare(`
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
      transaction(() => {
        const current = db.prepare("SELECT failures FROM g2b_notice_jobs WHERE id = ? AND status = 'running'").get(id);
        if (!current) return;
        if (attempts.length) {
          const finishAttempt = db.prepare(`UPDATE g2b_collection_attempts
            SET status = ?, finished_at = ?, error = ?, diagnostics = ?
            WHERE id = ? AND job_id = ? AND status = 'pending'`);
          for (const attempt of attempts) {
            finishAttempt.run(attempt.status, attempt.finishedAt, attempt.error,
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
        if (outcome.kind === "maintenance") markMaintenance();
        if (outcome.kind === "internal_error" || outcome.kind === "maintenance") {
          // 실행기가 종료하지 못한 시도만 정리하고 이전 진단과 완료 이력을 보존한다.
          db.prepare(`UPDATE g2b_collection_attempts SET status = ?, finished_at = ?, error = ?
            WHERE status = 'pending' AND job_id = ?`)
            .run(outcome.kind === "maintenance" ? "deferred" : "failed", new Date(now).toISOString(), outcome.error, id);
        }
        if (outcome.kind === "success" || outcome.kind === "failure") {
          const walks = db.prepare("SELECT walk_id FROM g2b_notice_walk_visits WHERE job_id = ?").all(id);
          for (const { walk_id } of walks) {
            for (const input of outcome.related ?? []) attach(Number(walk_id), input, false);
          }
        }
        // 종료 시 이미 예약된 강제 작업이 있으면 현재 작업은 일반 재시도 규칙을 그대로 따른다.
        db.prepare("UPDATE g2b_notice_jobs SET status = ?, failures = ?, availableAt = ?, error = ?, result = ? WHERE id = ?")
          .run(status, failures, status === "retry_wait" ? now + 60_000 : 0,
            outcome.kind === "success" ? null : outcome.error,
            JSON.stringify(("result" in outcome ? outcome.result : null) ?? null), id);
      });
    },
    recover() {
      transaction(() => {
        if (db.prepare("SELECT 1 FROM pragma_table_info('g2b_collection_attempts') WHERE name = 'job_id'").get()) {
          db.prepare(`UPDATE g2b_collection_attempts SET status = 'deferred', finished_at = ?, error = ?
            WHERE status = 'pending' AND job_id IN (SELECT id FROM g2b_notice_jobs WHERE status = 'running')`)
            .run(new Date().toISOString(), "워커 종료로 수집이 중단되었습니다.");
          db.prepare(`UPDATE g2b_collection_attempts SET status = 'deferred', finished_at = ?, error = ?
            WHERE status = 'pending' AND job_id IN (SELECT id FROM g2b_notice_jobs WHERE status <> 'running')`)
            .run(new Date().toISOString(), "수집 시도의 종료 결과를 확인할 수 없습니다.");
        }
        db.exec("UPDATE g2b_notice_jobs SET status = 'pending', availableAt = 0 WHERE status = 'running'");
        db.exec("UPDATE g2b_notice_runs SET phase = 'pending' WHERE phase = 'discovering'");
      });
    },
    get(id) {
      const row = db.prepare("SELECT * FROM g2b_notice_jobs WHERE id = ?").get(id) as JobRow | undefined;
      return row && job(row);
    },
    overview() {
      const { manual, maintenance } = state();
      const active = db.prepare("SELECT id FROM g2b_notice_jobs WHERE status = 'running'").get();
      const jobs = db.prepare("SELECT * FROM g2b_notice_jobs ORDER BY status = 'running' DESC, id DESC LIMIT 50").all() as JobRow[];
      return { manual: Boolean(manual), maintenance, active: active ? Number(active.id) : null, jobs: jobs.map(job) };
    },
    maintenanceVersion() {
      return state().maintenance;
    },
    setManual(paused) {
      db.prepare("UPDATE g2b_notice_queue SET manual = ? WHERE id = 1").run(Number(paused));
    },
    markMaintenance,
    clearMaintenance(version) {
      db.prepare("UPDATE g2b_notice_queue SET maintenance = 0 WHERE id = 1 AND maintenance = ?").run(version);
    },
  };
}
