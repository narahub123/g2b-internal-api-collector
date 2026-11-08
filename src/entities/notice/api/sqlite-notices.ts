import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { OrderPlan } from '@/entities/order-plan/model/order-plan';
import type { Notice, NoticeKey, NoticeRepository, NoticeSummary } from '../model/types';

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
    CREATE TABLE IF NOT EXISTS order_plans (
      number TEXT NOT NULL PRIMARY KEY,
      collected_at TEXT NOT NULL,
      data TEXT NOT NULL
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
  const findOrderPlan = db.prepare('SELECT data FROM order_plans WHERE number = ?');
  const saveOrderPlan = db.prepare(`
    INSERT INTO order_plans (number, collected_at, data) VALUES (?, ?, ?)
    ON CONFLICT (number) DO NOTHING
  `);
  const saveOrderPlanAttachments = db.prepare(`
    UPDATE order_plans SET data = json_set(data, '$.attachments', json(?))
    WHERE number = ? AND json_type(data, '$.attachments') IS NULL
  `);
  // 기존에 수집한 공고도 원본 응답에 기록된 계획번호로 연결한다.
  const findNoticesForOrderPlan = db.prepare(`
    SELECT number, revision FROM notices
    WHERE coalesce(
      nullif(trim(json_extract(data, '$.payload.dmItemMap.oderPlanUntyNo')), ''),
      trim(json_extract(data, '$.payload.dmItemMap.oderPlanNo'))
    ) = ?
    ORDER BY number, revision
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
    findOrderPlan(number) {
      const row = findOrderPlan.get(number);
      return row ? JSON.parse(String(row.data)) as OrderPlan : null;
    },
    saveOrderPlan(plan) {
      saveOrderPlan.run(plan.number, plan.collectedAt, JSON.stringify(plan));
    },
    saveOrderPlanAttachments(number, attachments) {
      saveOrderPlanAttachments.run(JSON.stringify(attachments), number);
    },
    findNoticesForOrderPlan(number) {
      return findNoticesForOrderPlan.all(number) as NoticeKey[];
    },
  };
}
