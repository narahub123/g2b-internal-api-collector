import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ContractRequest } from '@/entities/contract-request/model/contract-request';
import type { Contract } from '@/entities/contract/model/contract';
import type { OpeningResult } from '@/entities/opening-result/model/opening-result';
import type { OrderPlan } from '@/entities/order-plan/model/order-plan';
import type { PriorSpec } from '@/entities/prior-spec/model/prior-spec';
import type { Notice, NoticeKey, NoticeSummary } from '@/entities/notice/model/types';
import type { G2bRepository } from './types';

export function openG2bRepository(): G2bRepository {
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
    CREATE TABLE IF NOT EXISTS prior_specs (
      number TEXT NOT NULL PRIMARY KEY,
      collected_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contract_requests (
      number TEXT NOT NULL,
      revision TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (number, revision)
    );
    CREATE TABLE IF NOT EXISTS contracts (
      number TEXT NOT NULL,
      revision TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (number, revision)
    );
    CREATE TABLE IF NOT EXISTS opening_results (
      number TEXT NOT NULL,
      revision TEXT NOT NULL,
      opening_revision TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (number, revision, opening_revision)
    );
  `);
  const list = db.prepare(`
    SELECT number, revision, collected_at AS collectedAt, json_extract(data, '$.title') AS title,
      CAST(json_extract(data, '$.payload.dmItemMap.prcmBsneSeCd') AS TEXT) AS businessCode,
      CAST(json_extract(data, '$.payload.dmItemMap.prcmBsneSeNm') AS TEXT) AS businessLabel
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
  const findOpeningResult = db.prepare('SELECT data FROM opening_results WHERE number = ? AND revision = ? AND opening_revision = ?');
  const listOpeningResults = db.prepare('SELECT data FROM opening_results WHERE number = ? AND revision = ? ORDER BY opening_revision');
  const saveOpeningResult = db.prepare(`
    INSERT INTO opening_results (number, revision, opening_revision, collected_at, data) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (number, revision, opening_revision) DO UPDATE SET collected_at = excluded.collected_at, data = excluded.data
    WHERE excluded.collected_at >= opening_results.collected_at
  `);
  const findContract = db.prepare('SELECT data FROM contracts WHERE number = ? AND revision = ?');
  const saveContract = db.prepare(`
    INSERT INTO contracts (number, revision, collected_at, data) VALUES (?, ?, ?, ?)
    ON CONFLICT (number, revision) DO UPDATE SET
      collected_at = excluded.collected_at, data = excluded.data
    WHERE excluded.collected_at >= contracts.collected_at
  `);
  const findContractRequest = db.prepare('SELECT data FROM contract_requests WHERE number = ? AND revision = ?');
  const saveContractRequest = db.prepare(`
    INSERT INTO contract_requests (number, revision, collected_at, data) VALUES (?, ?, ?, ?)
    ON CONFLICT (number, revision) DO UPDATE SET collected_at = excluded.collected_at, data = excluded.data
    WHERE excluded.collected_at >= contract_requests.collected_at
  `);
  const replaceOrderPlan = db.prepare(`
    INSERT INTO order_plans (number, collected_at, data) VALUES (?, ?, ?)
    ON CONFLICT (number) DO UPDATE SET collected_at = excluded.collected_at, data = excluded.data
    WHERE excluded.collected_at >= order_plans.collected_at
  `);
  const findPriorSpec = db.prepare('SELECT data FROM prior_specs WHERE number = ?');
  const savePriorSpec = db.prepare(`
    INSERT INTO prior_specs (number, collected_at, data) VALUES (?, ?, ?)
    ON CONFLICT (number) DO UPDATE SET collected_at = excluded.collected_at, data = excluded.data
    WHERE excluded.collected_at >= prior_specs.collected_at
  `);
  const saveOrderPlan = db.prepare(`
    INSERT INTO order_plans (number, collected_at, data) VALUES (?, ?, ?)
    ON CONFLICT (number) DO NOTHING
  `);
  const saveOrderPlanAttachments = db.prepare(`
    UPDATE order_plans SET data = json_set(data, '$.attachments', json(?))
    WHERE number = ? AND collected_at = ? AND json_type(data, '$.attachments') IS NULL
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
    findOpeningResult({ number, revision, openingRevision }) {
      const row = findOpeningResult.get(number, revision, openingRevision);
      return row ? JSON.parse(String(row.data)) as OpeningResult : null;
    },
    listOpeningResults({ number, revision }) {
      return listOpeningResults.all(number, revision).map((row) => JSON.parse(String(row.data)) as OpeningResult);
    },
    saveOpeningResult(result) {
      saveOpeningResult.run(result.number, result.revision, result.openingRevision, result.collectedAt, JSON.stringify(result));
    },
    findContract({ number, revision }) {
      const row = findContract.get(number, revision);
      return row ? JSON.parse(String(row.data)) as Contract : null;
    },
    saveContract(contract) {
      saveContract.run(contract.number, contract.revision, contract.collectedAt, JSON.stringify(contract));
    },
    findContractRequest({ number, revision }) {
      const row = findContractRequest.get(number, revision);
      return row ? JSON.parse(String(row.data)) as ContractRequest : null;
    },
    saveContractRequest({ number, revision, collectedAt, ...data }) {
      saveContractRequest.run(number, revision, collectedAt, JSON.stringify({ number, revision, collectedAt, ...data }));
    },
    findOrderPlan(number) {
      const row = findOrderPlan.get(number);
      return row ? JSON.parse(String(row.data)) as OrderPlan : null;
    },
    saveOrderPlan(plan) {
      saveOrderPlan.run(plan.number, plan.collectedAt, JSON.stringify(plan));
    },
    saveOrderPlanAttachments(number, collectedAt, attachments) {
      saveOrderPlanAttachments.run(JSON.stringify(attachments), number, collectedAt);
    },
    findNoticesForOrderPlan(number) {
      return findNoticesForOrderPlan.all(number) as NoticeKey[];
    },
    replaceOrderPlan(plan) {
      replaceOrderPlan.run(plan.number, plan.collectedAt, JSON.stringify(plan));
    },
    findPriorSpec(number) {
      const row = findPriorSpec.get(number);
      return row ? JSON.parse(String(row.data)) as PriorSpec : null;
    },
    savePriorSpec(spec) {
      savePriorSpec.run(spec.number, spec.collectedAt, JSON.stringify(spec));
    },
  };
}
