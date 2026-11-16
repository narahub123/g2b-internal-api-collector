import type { Client } from "@libsql/client";

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

/**
 * 초기 스키마와 적용 이력을 같은 쓰기 트랜잭션으로 기록한다.
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
    await transaction.commit();
  } finally {
    transaction.close();
  }
}
