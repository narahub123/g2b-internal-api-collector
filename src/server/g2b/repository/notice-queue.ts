import type { DatabaseSync } from "node:sqlite";
import type { NoticeJob, NoticeQueue, NoticeQueueInput } from "./notice-queue-types";

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
  `);

  function transaction<T>(run: () => T): T {
    db.exec("BEGIN IMMEDIATE");
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

  return {
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
        const walk = Number(db.prepare("INSERT INTO g2b_notice_walks DEFAULT VALUES").run().lastInsertRowid);
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
    finish(id, outcome, now) {
      transaction(() => {
        const current = db.prepare("SELECT failures FROM g2b_notice_jobs WHERE id = ? AND status = 'running'").get(id);
        if (!current) return;
        const failures = Number(current.failures) + Number(outcome.kind === "failure");
        const status = outcome.kind === "success" ? "succeeded" : outcome.kind === "maintenance" ? "pending" : failures >= 3 ? "failed" : "retry_wait";
        if (outcome.kind === "maintenance") markMaintenance();
        if (outcome.kind !== "maintenance") {
          const walks = db.prepare("SELECT walk_id FROM g2b_notice_walk_visits WHERE job_id = ?").all(id);
          for (const { walk_id } of walks) {
            for (const input of outcome.related ?? []) attach(Number(walk_id), input, false);
          }
        }
        // 종료 시 이미 예약된 강제 작업이 있으면 현재 작업은 일반 재시도 규칙을 그대로 따른다.
        db.prepare("UPDATE g2b_notice_jobs SET status = ?, failures = ?, availableAt = ?, error = ?, result = ? WHERE id = ?")
          .run(status, failures, status === "retry_wait" ? now + 60_000 : 0,
            outcome.kind === "success" ? null : outcome.error, JSON.stringify(outcome.result ?? null), id);
      });
    },
    recover() {
      transaction(() => {
        if (db.prepare("SELECT 1 FROM pragma_table_info('g2b_collection_attempts') WHERE name = 'job_id'").get()) {
          db.prepare(`UPDATE g2b_collection_attempts SET status = 'deferred', finished_at = ?, error = ?
            WHERE status = 'pending' AND job_id IN (SELECT id FROM g2b_notice_jobs WHERE status = 'running')`)
            .run(new Date().toISOString(), "워커 종료로 수집이 중단되었습니다.");
        }
        db.exec("UPDATE g2b_notice_jobs SET status = 'pending', availableAt = 0 WHERE status = 'running'");
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
