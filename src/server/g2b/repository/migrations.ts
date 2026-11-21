import type { Client } from "@libsql/client";
import { priorSpecUnavailableStatus } from "@/shared/config/g2b-prior-spec";
import {
  orderPlanLinkPredicate, orderPlanLookupSql, orderPlanNumberSql, orderPlanUnavailablePredicate,
} from "./order-plan-notice-sql";

const initialSchema = `
    CREATE TABLE IF NOT EXISTS notices (
      number TEXT NOT NULL,
      revision TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      data TEXT NOT NULL,
      query_data TEXT NOT NULL,
      PRIMARY KEY (number, revision)
    );
    CREATE TABLE IF NOT EXISTS order_plans (
      number TEXT NOT NULL PRIMARY KEY,
      collected_at TEXT NOT NULL,
      data TEXT NOT NULL,
      query_data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prior_specs (
      number TEXT NOT NULL PRIMARY KEY,
      collected_at TEXT NOT NULL,
      data TEXT NOT NULL,
      query_data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contract_requests (
      number TEXT NOT NULL,
      revision TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      data TEXT NOT NULL,
      query_data TEXT NOT NULL,
      PRIMARY KEY (number, revision)
    );
    CREATE TABLE IF NOT EXISTS contracts (
      number TEXT NOT NULL,
      revision TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      data TEXT NOT NULL,
      query_data TEXT NOT NULL,
      PRIMARY KEY (number, revision)
    );
    CREATE TABLE IF NOT EXISTS opening_results (
      number TEXT NOT NULL,
      revision TEXT NOT NULL,
      opening_revision TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      data TEXT NOT NULL,
      query_data TEXT NOT NULL,
      PRIMARY KEY (number, revision, opening_revision)
    );

    CREATE TABLE IF NOT EXISTS g2b_collection_attempts (
      id INTEGER PRIMARY KEY,
      section TEXT NOT NULL,
      number TEXT NOT NULL,
      revision TEXT NOT NULL,
      opening_revision TEXT NOT NULL,
      input TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      diagnostics TEXT,
      job_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS g2b_collection_attempts_target
      ON g2b_collection_attempts (section, number, revision, opening_revision, id DESC);

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
    CREATE TABLE IF NOT EXISTS g2b_notice_worker_lease (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      token TEXT,
      expires_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO g2b_notice_worker_lease (id) VALUES (1);
`;

// 진행 중 작업은 회차를 넘겨 처리하므로 0번에, 종료 결과는 마지막 자동 탐색에 집계한다.
const automaticBucket = (row: string) =>
  `CASE WHEN ${row}.status IN ('succeeded', 'failed') THEN ${row}.automaticWalkId ELSE 0 END`;
const automaticStatus = (row: string) =>
  `CASE WHEN ${row}.status = 'retry_wait' THEN 'pending' ELSE ${row}.status END`;
const addAutomaticCount = `
  INSERT INTO g2b_notice_automatic_counts (bucket, status, count)
  SELECT ${automaticBucket("NEW")}, ${automaticStatus("NEW")}, 1 WHERE NEW.automaticWalkId IS NOT NULL
  ON CONFLICT(bucket, status) DO UPDATE SET count = count + 1;`;
const removeAutomaticCount = `
  UPDATE g2b_notice_automatic_counts SET count = count - 1
    WHERE OLD.automaticWalkId IS NOT NULL AND bucket = ${automaticBucket("OLD")} AND status = ${automaticStatus("OLD")};`;

/**
 * 스키마 변경과 적용 이력을 같은 쓰기 트랜잭션으로 기록한다.
 * @throws 연결 또는 스키마 적용에 실패하면 원래 오류를 전달한다.
 */
export async function migrateG2bDatabase(client: Client): Promise<void> {
  const transaction = await client.transaction("write");
  try {
    await transaction.execute("CREATE TABLE IF NOT EXISTS g2b_schema_migrations (version INTEGER PRIMARY KEY)");
    const applied = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 1");
    if (applied.rows.length === 0) {
      await transaction.executeMultiple(initialSchema);
      await transaction.execute("INSERT INTO g2b_schema_migrations (version) VALUES (1)");
    }
    const queueUpgrade = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 2");
    if (queueUpgrade.rows.length === 0) {
      // 자동 수집 도입 이전의 작업은 기존 수동 요청에서 비롯됐다.
      await transaction.executeMultiple(`
        ALTER TABLE g2b_notice_runs ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
        ALTER TABLE g2b_notice_runs ADD COLUMN coveredThrough TEXT;
        ALTER TABLE g2b_notice_walks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
        ALTER TABLE g2b_notice_walk_visits ADD COLUMN initialTarget INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE g2b_notice_jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
        ALTER TABLE g2b_notice_jobs ADD COLUMN hasFirstResult INTEGER NOT NULL DEFAULT 0;
        UPDATE g2b_notice_jobs SET hasFirstResult = 1
          WHERE failures > 0 OR status IN ('succeeded', 'failed');
        INSERT INTO g2b_schema_migrations (version) VALUES (2);
      `);
    }
    const automaticUpgrade = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 3");
    if (automaticUpgrade.rows.length === 0) {
      // 재개 전에 접수한 공고는 보존하고 구간 완료 시각만 현재 일정 세대로 한정한다.
      await transaction.executeMultiple(`
        ALTER TABLE g2b_notice_runs ADD COLUMN scheduleGeneration INTEGER;
        ALTER TABLE g2b_notice_runs ADD COLUMN scheduleFinishedAt INTEGER;
        CREATE INDEX g2b_notice_runs_schedule ON g2b_notice_runs (scheduleGeneration, phase);
        CREATE TABLE g2b_notice_automatic (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 0,
          interval INTEGER NOT NULL DEFAULT 60 CHECK (interval IN (30, 60, 120)),
          startMinute TEXT,
          nextAt INTEGER,
          generation INTEGER NOT NULL DEFAULT 0,
          immediate INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO g2b_notice_automatic (id) VALUES (1);
        INSERT INTO g2b_schema_migrations (version) VALUES (3);
      `);
    }
    const actionsUpgrade = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 4");
    if (actionsUpgrade.rows.length === 0) {
      // Actions가 실행권을 얻기 전까지 중복 호출을 제한하고, 러너가 시작하지 않으면 예약을 만료시킨다.
      await transaction.executeMultiple(`
        ALTER TABLE g2b_notice_queue ADD COLUMN dispatchToken TEXT;
        ALTER TABLE g2b_notice_queue ADD COLUMN dispatchUntil INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE g2b_notice_automatic ADD COLUMN probeMaintenance INTEGER;
        INSERT INTO g2b_schema_migrations (version) VALUES (4);
      `);
    }
    const overviewUpgrade = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 5");
    if (overviewUpgrade.rows.length === 0) {
      // 실행 중 작업을 우선하고 최신순으로 50건을 읽는 큐 조회의 정렬식을 인덱스에 맞춘다.
      await transaction.executeMultiple(`
        CREATE INDEX g2b_notice_jobs_overview ON g2b_notice_jobs ((status = 'running') DESC, id DESC);
        INSERT INTO g2b_schema_migrations (version) VALUES (5);
      `);
    }
    const automaticListsUpgrade = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 6");
    if (automaticListsUpgrade.rows.length === 0) {
      await transaction.executeMultiple(`
        ALTER TABLE g2b_notice_jobs ADD COLUMN automaticWalkId INTEGER;
        WITH membership AS MATERIALIZED (
          SELECT v.job_id, MAX(v.walk_id) AS walkId
          FROM g2b_notice_runs r JOIN g2b_notice_walk_visits v ON v.walk_id = r.walkId
          WHERE r.source = 'automatic' GROUP BY v.job_id
        )
        UPDATE g2b_notice_jobs AS j SET automaticWalkId = membership.walkId
          FROM membership WHERE j.id = membership.job_id;
        CREATE TABLE g2b_notice_automatic_counts (
          bucket INTEGER NOT NULL,
          status TEXT NOT NULL,
          count INTEGER NOT NULL CHECK (count >= 0),
          PRIMARY KEY (bucket, status)
        ) WITHOUT ROWID;
        INSERT INTO g2b_notice_automatic_counts
          SELECT ${automaticBucket("j")}, ${automaticStatus("j")}, COUNT(*)
          FROM g2b_notice_jobs j WHERE j.automaticWalkId IS NOT NULL GROUP BY 1, 2;
        CREATE TRIGGER g2b_notice_automatic_count_insert AFTER INSERT ON g2b_notice_jobs
          WHEN NEW.automaticWalkId IS NOT NULL BEGIN ${addAutomaticCount} END;
        CREATE TRIGGER g2b_notice_automatic_count_delete AFTER DELETE ON g2b_notice_jobs
          WHEN OLD.automaticWalkId IS NOT NULL BEGIN ${removeAutomaticCount} END;
        CREATE TRIGGER g2b_notice_automatic_count_update AFTER UPDATE OF status, automaticWalkId ON g2b_notice_jobs
          WHEN (OLD.automaticWalkId IS NOT NULL OR NEW.automaticWalkId IS NOT NULL)
            AND ((OLD.automaticWalkId IS NULL) <> (NEW.automaticWalkId IS NULL)
              OR ${automaticBucket("OLD")} IS NOT ${automaticBucket("NEW")}
              OR ${automaticStatus("OLD")} <> ${automaticStatus("NEW")})
          BEGIN ${removeAutomaticCount} ${addAutomaticCount} END;
        -- 이전 버전의 워커가 회차를 등록하는 동안에도 소속과 집계가 함께 반영되어야 한다.
        CREATE TRIGGER g2b_notice_automatic_membership AFTER INSERT ON g2b_notice_walk_visits
          WHEN EXISTS (SELECT 1 FROM g2b_notice_walks WHERE id = NEW.walk_id AND source = 'automatic')
          BEGIN
            UPDATE g2b_notice_jobs SET automaticWalkId = NEW.walk_id
              WHERE id = NEW.job_id AND (automaticWalkId IS NULL OR automaticWalkId < NEW.walk_id);
          END;
        CREATE INDEX g2b_notice_auto_latest_walk ON g2b_notice_runs (walkId DESC)
          WHERE source = 'automatic' AND walkId IS NOT NULL;
        CREATE INDEX g2b_notice_auto_active ON g2b_notice_jobs (id DESC)
          WHERE automaticWalkId IS NOT NULL AND status IN ('pending', 'retry_wait', 'running');
        CREATE INDEX g2b_notice_auto_terminal ON g2b_notice_jobs (automaticWalkId, id DESC)
          WHERE status IN ('succeeded', 'failed');
        CREATE INDEX g2b_notice_auto_failed ON g2b_notice_jobs (automaticWalkId, id DESC)
          WHERE status = 'failed';
        CREATE INDEX g2b_notice_auto_queue_state ON g2b_notice_jobs (status) WHERE source = 'automatic';
        CREATE INDEX g2b_notice_auto_unfinished_runs ON g2b_notice_runs (scheduleGeneration)
          WHERE phase IN ('pending', 'discovering', 'collecting') AND coveredThrough IS NULL;
        INSERT INTO g2b_schema_migrations (version) VALUES (6);
      `);
    }
    const periodUpgrade = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 7");
    if (periodUpgrade.rows.length === 0) {
      await transaction.executeMultiple(`
        ALTER TABLE g2b_notice_walk_visits ADD COLUMN periodStatus TEXT;
        CREATE INDEX g2b_notice_manual_runs ON g2b_notice_runs (id DESC) WHERE source = 'manual';
        CREATE UNIQUE INDEX g2b_notice_manual_run_walk ON g2b_notice_runs (walkId)
          WHERE source = 'manual' AND walkId IS NOT NULL;
        CREATE INDEX g2b_notice_period_visits ON g2b_notice_walk_visits (walk_id);
        CREATE TABLE g2b_notice_period_counts (
          walk_id INTEGER PRIMARY KEY,
          total INTEGER NOT NULL,
          completed INTEGER NOT NULL,
          failed INTEGER NOT NULL
        );
        UPDATE g2b_notice_walk_visits AS v
          SET periodStatus = CASE WHEN j.status IN ('succeeded', 'failed') THEN j.status ELSE 'active' END
          FROM g2b_notice_runs r JOIN g2b_notice_jobs j
          WHERE r.source = 'manual' AND r.walkId = v.walk_id AND j.id = v.job_id;
        INSERT INTO g2b_notice_period_counts
          SELECT walk_id, COUNT(*), SUM(periodStatus = 'succeeded'), SUM(periodStatus = 'failed')
          FROM g2b_notice_walk_visits WHERE periodStatus IS NOT NULL GROUP BY walk_id;
        CREATE INDEX g2b_notice_period_failed ON g2b_notice_walk_visits (walk_id) WHERE periodStatus = 'failed';
        CREATE INDEX g2b_notice_period_job ON g2b_notice_walk_visits (job_id) WHERE periodStatus IS NOT NULL;
        -- 초기 방문은 회차에 walkId를 기록할 때 등록하고 연관 공고는 방문을 추가할 때 등록한다.
        CREATE TRIGGER g2b_notice_period_run AFTER UPDATE OF walkId ON g2b_notice_runs
          WHEN NEW.source = 'manual' AND OLD.walkId IS NULL AND NEW.walkId IS NOT NULL
          BEGIN
            UPDATE g2b_notice_walk_visits SET periodStatus = (
              SELECT CASE WHEN status IN ('succeeded', 'failed') THEN status ELSE 'active' END
              FROM g2b_notice_jobs WHERE id = job_id
            ) WHERE walk_id = NEW.walkId;
          END;
        CREATE TRIGGER g2b_notice_period_visit AFTER INSERT ON g2b_notice_walk_visits
          WHEN EXISTS (SELECT 1 FROM g2b_notice_runs WHERE source = 'manual' AND walkId = NEW.walk_id)
          BEGIN
            UPDATE g2b_notice_walk_visits SET periodStatus = (
              SELECT CASE WHEN status IN ('succeeded', 'failed') THEN status ELSE 'active' END
              FROM g2b_notice_jobs WHERE id = NEW.job_id
            ) WHERE rowid = NEW.rowid;
          END;
        CREATE TRIGGER g2b_notice_period_job_status AFTER UPDATE OF status ON g2b_notice_jobs
          WHEN OLD.status <> NEW.status
            AND (OLD.status IN ('succeeded', 'failed') OR NEW.status IN ('succeeded', 'failed'))
          BEGIN
            UPDATE g2b_notice_walk_visits SET periodStatus =
              CASE WHEN NEW.status IN ('succeeded', 'failed') THEN NEW.status ELSE 'active' END
              WHERE job_id = NEW.id AND periodStatus IS NOT NULL;
          END;
        CREATE TRIGGER g2b_notice_period_count AFTER UPDATE OF periodStatus ON g2b_notice_walk_visits
          WHEN OLD.periodStatus IS NOT NEW.periodStatus AND NEW.periodStatus IS NOT NULL
          BEGIN
            INSERT INTO g2b_notice_period_counts (walk_id, total, completed, failed)
              VALUES (NEW.walk_id, 1, NEW.periodStatus = 'succeeded', NEW.periodStatus = 'failed')
              ON CONFLICT(walk_id) DO UPDATE SET
                total = total + (OLD.periodStatus IS NULL),
                completed = completed + excluded.completed - (OLD.periodStatus IS 'succeeded'),
                failed = failed + excluded.failed - (OLD.periodStatus IS 'failed');
          END;
        INSERT INTO g2b_schema_migrations (version) VALUES (7);
      `);
    }
    const queueCountsUpgrade = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 8");
    if (queueCountsUpgrade.rows.length === 0) {
      // 큐 전체의 건수는 한 행에 저장하고, 표시상 같은 대기 상태 사이의 전환은 건수를 바꾸지 않는다.
      const predicates = {
        pending: "status IN ('pending', 'retry_wait')",
        running: "status = 'running'",
        completed: "status = 'succeeded'",
        failed: "status = 'failed'",
      };
      const columns = Object.entries(predicates);
      const matches = (row: string, predicate: string) => `(${row}.${predicate})`;
      const assignments = (delta: (predicate: string) => string) =>
        columns.map(([column, predicate]) => `${column} = ${column} ${delta(predicate)}`).join(", ");
      await transaction.executeMultiple(`
        CREATE TABLE g2b_notice_queue_counts (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          pending INTEGER NOT NULL CHECK (pending >= 0),
          running INTEGER NOT NULL CHECK (running BETWEEN 0 AND 1),
          completed INTEGER NOT NULL CHECK (completed >= 0),
          failed INTEGER NOT NULL CHECK (failed >= 0)
        );
        INSERT INTO g2b_notice_queue_counts (id, ${Object.keys(predicates).join(", ")})
          SELECT 1, ${columns.map(([, predicate]) => `COALESCE(SUM(${predicate}), 0)`).join(", ")}
          FROM g2b_notice_jobs;
        CREATE TRIGGER g2b_notice_queue_count_insert AFTER INSERT ON g2b_notice_jobs
          BEGIN
            UPDATE g2b_notice_queue_counts SET ${assignments((p) => `+ ${matches("NEW", p)}`)} WHERE id = 1;
          END;
        CREATE TRIGGER g2b_notice_queue_count_delete AFTER DELETE ON g2b_notice_jobs
          BEGIN
            UPDATE g2b_notice_queue_counts SET ${assignments((p) => `- ${matches("OLD", p)}`)} WHERE id = 1;
          END;
        CREATE TRIGGER g2b_notice_queue_count_update AFTER UPDATE OF status ON g2b_notice_jobs
          WHEN OLD.status <> NEW.status
            AND NOT (OLD.status IN ('pending', 'retry_wait') AND NEW.status IN ('pending', 'retry_wait'))
          BEGIN
            UPDATE g2b_notice_queue_counts
              SET ${assignments((p) => `+ ${matches("NEW", p)} - ${matches("OLD", p)}`)} WHERE id = 1;
          END;
        INSERT INTO g2b_schema_migrations (version) VALUES (8);
      `);
    }
    const queueFailuresUpgrade = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 9");
    if (queueFailuresUpgrade.rows.length === 0) {
      // 자동 회차와 무관하게 최종 실패한 큐 작업을 ID 순으로 탐색한다.
      await transaction.executeMultiple(`
        CREATE INDEX g2b_notice_queue_failed ON g2b_notice_jobs (id) WHERE status = 'failed';
        INSERT INTO g2b_schema_migrations (version) VALUES (9);
      `);
    }
    const priorSpecUnavailableUpgrade = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 10");
    if (priorSpecUnavailableUpgrade.rows.length === 0) {
      // 사전규격 집계는 조회 불가 상태인 공고만 읽는다. 조건은 집계 쿼리와 일치해야 한다.
      await transaction.executeMultiple(`
        CREATE INDEX g2b_notice_prior_spec_unavailable ON notices (number)
          WHERE CASE WHEN json_valid(data)
            THEN json_extract(data, '$.priorSpecStatus') = '${priorSpecUnavailableStatus}'
          END;
        INSERT INTO g2b_schema_migrations (version) VALUES (10);
      `);
    }
    const orderPlanLookupUpgrade = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 11");
    if (orderPlanLookupUpgrade.rows.length === 0) {
      // 기존 공고의 파생 번호로 인덱스를 구성하고, 이후 공고 변경은 SQLite가 인덱스에 반영한다.
      await transaction.executeMultiple(`
        CREATE INDEX g2b_notice_order_plan_link ON notices (${orderPlanLookupSql}, ${orderPlanNumberSql})
          WHERE ${orderPlanLinkPredicate};
        CREATE INDEX g2b_notice_order_plan_unavailable ON notices (${orderPlanLookupSql})
          WHERE ${orderPlanUnavailablePredicate};
        INSERT INTO g2b_schema_migrations (version) VALUES (11);
      `);
    }
    const attachments = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 12");
    if (!attachments.rows.length) {
      // 성공 상태와 이벤트는 동일 트랜잭션에서 기록해 워커 중단 중에도 인계를 보존한다.
      await transaction.executeMultiple(`
        ALTER TABLE g2b_collection_attempts ADD COLUMN attachment_number TEXT;
        CREATE TABLE g2b_attachment_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, section TEXT NOT NULL,
          number TEXT NOT NULL, revision TEXT NOT NULL, completion_id INTEGER NOT NULL
        );
        CREATE TRIGGER g2b_attachment_notice_completed AFTER UPDATE OF status ON g2b_notice_jobs
          WHEN NEW.status = 'succeeded' AND OLD.status <> 'succeeded'
          BEGIN
            INSERT INTO g2b_attachment_events(section, number, revision, completion_id)
              VALUES ('notices', NEW.number, NEW.revision, NEW.id);
          END;
        CREATE TRIGGER g2b_attachment_collection_completed AFTER UPDATE OF status ON g2b_collection_attempts
          WHEN NEW.status = 'succeeded' AND OLD.status <> 'succeeded'
            AND NEW.section IN ('order-plans', 'prior-specs')
          BEGIN
            INSERT INTO g2b_attachment_events(section, number, revision, completion_id)
              VALUES (NEW.section, COALESCE(NEW.attachment_number, NEW.number), '', NEW.id);
          END;
        CREATE TABLE g2b_attachment_jobs (
          position INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, file TEXT NOT NULL,
          priority INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
          available_at INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
          token TEXT, expires_at INTEGER, hash TEXT, error TEXT
        );
        CREATE INDEX g2b_attachment_ready ON g2b_attachment_jobs(priority DESC, position)
          WHERE status = 'pending';
        CREATE INDEX g2b_attachment_retry ON g2b_attachment_jobs(available_at)
          WHERE status = 'retry_wait';
        CREATE INDEX g2b_attachment_leases ON g2b_attachment_jobs(expires_at)
          WHERE status = 'running';
        INSERT INTO g2b_schema_migrations (version) VALUES (12);
      `);
    }
    const attachmentRetry = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 13");
    if (!attachmentRetry.rows.length) {
      // 기존 이벤트는 즉시 처리하고, 최종 실패한 이벤트는 반복 조회 인덱스에서 제외한다.
      await transaction.executeMultiple(`
        ALTER TABLE g2b_attachment_events ADD COLUMN available_at INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE g2b_attachment_events ADD COLUMN failures INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE g2b_attachment_events ADD COLUMN error TEXT;
        ALTER TABLE g2b_attachment_events ADD COLUMN failed_at INTEGER;
        ALTER TABLE g2b_attachment_events ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX g2b_attachment_events_ready ON g2b_attachment_events(available_at, id)
          WHERE failed_at IS NULL;
        INSERT INTO g2b_schema_migrations (version) VALUES (13);
      `);
    }
    const pdfExtraction = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 14");
    if (!pdfExtraction.rows.length) {
      // 기존 작업의 상태와 무관하게 수동 요청 전까지 해시 처리 모드를 보존한다.
      await transaction.executeMultiple(`
        CREATE TABLE g2b_attachment_pdf_results (
          id INTEGER PRIMARY KEY, hash TEXT NOT NULL, version TEXT NOT NULL,
          page_count INTEGER NOT NULL, character_count INTEGER NOT NULL, UNIQUE(hash, version)
        );
        CREATE TABLE g2b_attachment_pdf_pages (
          result_id INTEGER NOT NULL REFERENCES g2b_attachment_pdf_results(id),
          page_number INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(result_id, page_number)
        );
        ALTER TABLE g2b_attachment_jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'hash_only';
        ALTER TABLE g2b_attachment_jobs ADD COLUMN pdf_result_id INTEGER REFERENCES g2b_attachment_pdf_results(id);
        INSERT INTO g2b_schema_migrations (version) VALUES (14);
      `);
    }
    const attachmentDispatch = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 15");
    if (!attachmentDispatch.rows.length) {
      // 수집 워커와 웹의 자동 호출이 같은 예약을 공유한다.
      await transaction.executeMultiple(`
        CREATE TABLE g2b_attachment_dispatch (
          id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT, expires_at INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO g2b_attachment_dispatch (id) VALUES (1);
        INSERT INTO g2b_schema_migrations (version) VALUES (15);
      `);
    }
    const attachmentWorkerLease = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 16");
    if (!attachmentWorkerLease.rows.length) {
      // 작업별 선점과 별도로 러너 시작 대기 및 워커 전체의 소유권을 관리한다.
      await transaction.executeMultiple(`
        ALTER TABLE g2b_attachment_dispatch ADD COLUMN worker_token TEXT;
        ALTER TABLE g2b_attachment_dispatch ADD COLUMN worker_expires_at INTEGER NOT NULL DEFAULT 0;
        UPDATE g2b_attachment_dispatch SET token = NULL, expires_at = 0 WHERE id = 1;
        INSERT INTO g2b_schema_migrations (version) VALUES (16);
      `);
    }
    const attachmentExtraction = await transaction.execute("SELECT 1 FROM g2b_schema_migrations WHERE version = 17");
    if (!attachmentExtraction.rows.length) {
      // 기존 PDF 미리보기의 서명과 페이지 경로가 같은 결과를 가리키도록 ID와 순번을 보존한다.
      await transaction.executeMultiple(`
        CREATE TABLE g2b_attachment_results (
          id INTEGER PRIMARY KEY, hash TEXT NOT NULL, format TEXT NOT NULL, extractor_version TEXT NOT NULL,
          unit_count INTEGER NOT NULL, character_count INTEGER NOT NULL, UNIQUE(hash, format, extractor_version)
        );
        CREATE TABLE g2b_attachment_result_units (
          result_id INTEGER NOT NULL REFERENCES g2b_attachment_results(id),
          unit_number INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(result_id, unit_number)
        );
        ALTER TABLE g2b_attachment_jobs ADD COLUMN result_id INTEGER REFERENCES g2b_attachment_results(id);
        INSERT INTO g2b_attachment_results
          SELECT id, hash, 'pdf', version, page_count, character_count FROM g2b_attachment_pdf_results;
        INSERT INTO g2b_attachment_result_units
          SELECT result_id, page_number, text FROM g2b_attachment_pdf_pages;
        UPDATE g2b_attachment_jobs SET result_id = pdf_result_id WHERE pdf_result_id IS NOT NULL;
        UPDATE g2b_attachment_jobs SET mode = 'extract' WHERE mode = 'pdf_extract';
        INSERT INTO g2b_schema_migrations (version) VALUES (17);
      `);
    }
    await transaction.commit();
  } finally {
    transaction.close();
  }
}
