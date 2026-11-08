import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Notice, NoticeRepository, NoticeSummary } from '../model/types';

export function openNoticeRepository(): NoticeRepository {
  const directory = join(process.cwd(), '.data');
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'notices.sqlite'));
  db.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS notices (
      number TEXT NOT NULL,
      revision TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (number, revision)
    );
  `);
  const list = db.prepare(`
    SELECT number, revision, collected_at AS collectedAt, json_extract(data, '$.title') AS title
    FROM notices ORDER BY collected_at DESC, number, revision
  `);
  const find = db.prepare('SELECT data FROM notices WHERE number = ? AND revision = ?');
  const save = db.prepare(`
    INSERT INTO notices (number, revision, collected_at, data) VALUES (?, ?, ?, ?)
    ON CONFLICT (number, revision) DO UPDATE SET
      collected_at = excluded.collected_at, data = excluded.data
    WHERE excluded.collected_at >= notices.collected_at
  `);

  return {
    async list() {
      return list.all() as NoticeSummary[];
    },
    async find({ number, revision }) {
      const row = find.get(number, revision);
      return row ? JSON.parse(String(row.data)) as Notice : null;
    },
    async save(notice) {
      save.run(notice.number, notice.revision, notice.collectedAt, JSON.stringify(notice));
    },
  };
}
