import { collectionQueryData, noticeQueryData, openingQueryData } from "./query-data";
import type { G2bDatabase } from "./database";
import type { ContractRequest } from '@/entities/contract-request/model/contract-request';
import type { Contract } from '@/entities/contract/model/contract';
import type { OpeningResult } from '@/entities/opening-result/model/opening-result';
import type { OrderPlan } from '@/entities/order-plan/model/order-plan';
import type { PriorSpec } from '@/entities/prior-spec/model/prior-spec';
import type { Notice, NoticeKey, NoticeSummary } from '@/entities/notice/model/types';
import { etcNoticeDetail } from '@/entities/notice/model/notice-detail';
import type { G2bCollectionCounts, G2bRepository } from './types';
import { openNoticeQueue } from './notice-queue';
import { openCollectionAttempts } from './collection-attempts';
import { openCollectionDeletion } from './collection-deletion';

// 저장 키와 업무별 상세 응답의 번호·차수가 일치해야 재사용할 수 있다.
function usableNotice(notice: Notice | null, { number, revision }: NoticeKey) {
  const payload = notice?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const etc = etcNoticeDetail(payload);
  const detail = etc ?? payload.dmItemMap;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  const fields = detail as Record<string, unknown>;
  const detailNumber = etc ? fields.bidPbancUntyNo : fields.bidPbancNo;
  const order = etc ? fields.bidPbancUntyOrd : fields.bidPbancOrd;
  if (typeof order !== 'string' && typeof order !== 'number') return null;
  const detailRevision = String(order);
  return detailNumber === number && /^\d{1,3}$/.test(detailRevision) &&
    detailRevision.padStart(3, '0') === revision ? notice : null;
}

function parseUsableNotice(data: string, key: NoticeKey) {
  try {
    return usableNotice(JSON.parse(data) as Notice | null, key);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** 업무 원본과 큐를 같은 원격 연결에서 조회하고 갱신한다. */
export function openG2bRepository(db: G2bDatabase): G2bRepository {
  const collectionCounts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM order_plans) AS "order-plans",
      (SELECT COUNT(*) FROM prior_specs) AS "prior-specs",
      (SELECT COUNT(*) FROM notices) AS notices,
      (SELECT COUNT(*) FROM contract_requests) AS "contract-requests",
      (SELECT COUNT(*) FROM opening_results) AS "opening-results",
      (SELECT COUNT(*) FROM contracts) AS contracts
  `);
  const list = db.prepare(`
    SELECT number, revision, collected_at AS collectedAt, json_extract(data, '$.title') AS title,
      CAST(COALESCE(json_extract(data, '$.payload.dlUntyBidPbancM.prcmBsneSeCd'),
        json_extract(data, '$.payload.dmItemMap.prcmBsneSeCd')) AS TEXT) AS businessCode,
      CAST(json_extract(data, '$.payload.dmItemMap.prcmBsneSeNm') AS TEXT) AS businessLabel
    FROM notices WHERE json_valid(data) ORDER BY collected_at DESC, number, revision
  `);
  const find = db.prepare('SELECT data FROM notices WHERE number = ? AND revision = ?');
  // 정상적인 최신 응답은 보존하되 손상된 행의 저장 시각은 복구를 막지 않는다.
  const save = db.prepare(`
    INSERT INTO notices (number, revision, collected_at, data, query_data) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (number, revision) DO UPDATE SET
      collected_at = excluded.collected_at, data = excluded.data, query_data = excluded.query_data
    WHERE excluded.collected_at >= notices.collected_at
      OR COALESCE(json_extract(notices.query_data, '$.usable'), 0) = 0
  `);
  const findOrderPlan = db.prepare('SELECT data FROM order_plans WHERE number = ?');
  const findOpeningResult = db.prepare('SELECT data FROM opening_results WHERE number = ? AND revision = ? AND opening_revision = ?');
  const listOpeningResults = db.prepare('SELECT data FROM opening_results WHERE number = ? AND revision = ? ORDER BY opening_revision');
  const saveOpeningResult = db.prepare(`
    INSERT INTO opening_results (number, revision, opening_revision, collected_at, data, query_data) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (number, revision, opening_revision) DO UPDATE SET collected_at = excluded.collected_at, data = excluded.data, query_data = excluded.query_data
    WHERE excluded.collected_at >= opening_results.collected_at
  `);
  const findContract = db.prepare('SELECT data FROM contracts WHERE number = ? AND revision = ?');
  const saveContract = db.prepare(`
    INSERT INTO contracts (number, revision, collected_at, data, query_data) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (number, revision) DO UPDATE SET
      collected_at = excluded.collected_at, data = excluded.data, query_data = excluded.query_data
    WHERE excluded.collected_at >= contracts.collected_at
  `);
  const findContractRequest = db.prepare('SELECT data FROM contract_requests WHERE number = ? AND revision = ?');
  const saveContractRequest = db.prepare(`
    INSERT INTO contract_requests (number, revision, collected_at, data, query_data) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (number, revision) DO UPDATE SET collected_at = excluded.collected_at, data = excluded.data, query_data = excluded.query_data
    WHERE excluded.collected_at >= contract_requests.collected_at
  `);
  const replaceOrderPlan = db.prepare(`
    INSERT INTO order_plans (number, collected_at, data, query_data) VALUES (?, ?, ?, ?)
    ON CONFLICT (number) DO UPDATE SET collected_at = excluded.collected_at, data = excluded.data, query_data = excluded.query_data
    WHERE excluded.collected_at >= order_plans.collected_at
  `);
  const findPriorSpec = db.prepare('SELECT data FROM prior_specs WHERE number = ?');
  const savePriorSpec = db.prepare(`
    INSERT INTO prior_specs (number, collected_at, data, query_data) VALUES (?, ?, ?, ?)
    ON CONFLICT (number) DO UPDATE SET collected_at = excluded.collected_at, data = excluded.data, query_data = excluded.query_data
    WHERE excluded.collected_at >= prior_specs.collected_at
  `);
  const saveOrderPlan = db.prepare(`
    INSERT INTO order_plans (number, collected_at, data, query_data) VALUES (?, ?, ?, ?)
    ON CONFLICT (number) DO NOTHING
  `);
  const saveOrderPlanAttachments = db.prepare(`
    UPDATE order_plans SET data = json_set(data, '$.attachments', json(?))
    WHERE number = ? AND collected_at = ? AND json_type(data, '$.attachments') IS NULL
  `);
  // 실제 저장 번호를 우선 사용하고 기존 공고는 원본 응답에 기록된 계획번호로 연결한다.
  const findNoticesForOrderPlan = db.prepare(`
    SELECT number, revision FROM notices
    WHERE CASE WHEN json_valid(data) THEN coalesce(
      json_extract(data, '$.orderPlanNumber'),
      nullif(trim(json_extract(data, '$.payload.dmItemMap.oderPlanUntyNo')), ''),
      trim(json_extract(data, '$.payload.dmItemMap.oderPlanNo'))
    ) = ? END
    ORDER BY number, revision
  `);

  const collectionAttempts = openCollectionAttempts(db);
  const noticeQueue = openNoticeQueue(db);
  return {
    collectionAttempts,
    noticeQueue,
    collectionDeletion: openCollectionDeletion(db),
    /**
     * 수집 중에도 업무별 건수가 같은 읽기 시점을 기준으로 집계되도록 한 문장으로 조회한다.
     * @throws Turso가 집계 쿼리 실행에 실패한 경우.
     */
    async getCollectionCounts() {
      return await collectionCounts.get() as G2bCollectionCounts;
    },
    async list() {
      return await list.all() as NoticeSummary[];
    },
    async find({ number, revision }) {
      const row = await find.get(number, revision);
      return row ? JSON.parse(String(row.data)) as Notice : null;
    },
    async findUsableNotice({ number, revision }) {
      const row = await find.get(number, revision);
      return row ? parseUsableNotice(String(row.data), { number, revision }) : null;
    },
    async save(notice) {
      await save.run(notice.number, notice.revision, notice.collectedAt, JSON.stringify(notice), noticeQueryData(notice, Boolean(usableNotice(notice, notice))));
    },
    async findOpeningResult({ number, revision, openingRevision }) {
      const row = await findOpeningResult.get(number, revision, openingRevision);
      return row ? JSON.parse(String(row.data)) as OpeningResult : null;
    },
    async listOpeningResults({ number, revision }) {
      return (await listOpeningResults.all(number, revision)).map((row) => JSON.parse(String(row.data)) as OpeningResult);
    },
    async saveOpeningResult(result) {
      await saveOpeningResult.run(result.number, result.revision, result.openingRevision, result.collectedAt, JSON.stringify(result), openingQueryData(result));
    },
    async findContract({ number, revision }) {
      const row = await findContract.get(number, revision);
      return row ? JSON.parse(String(row.data)) as Contract : null;
    },
    async saveContract(contract) {
      await saveContract.run(contract.number, contract.revision, contract.collectedAt, JSON.stringify(contract), collectionQueryData("contracts", contract));
    },
    async findContractRequest({ number, revision }) {
      const row = await findContractRequest.get(number, revision);
      return row ? JSON.parse(String(row.data)) as ContractRequest : null;
    },
    async saveContractRequest({ number, revision, collectedAt, ...data }) {
      await saveContractRequest.run(number, revision, collectedAt, JSON.stringify({ number, revision, collectedAt, ...data }), collectionQueryData("contract-requests", data));
    },
    async findOrderPlan(number) {
      const row = await findOrderPlan.get(number);
      return row ? JSON.parse(String(row.data)) as OrderPlan : null;
    },
    async saveOrderPlan(plan) {
      await saveOrderPlan.run(plan.number, plan.collectedAt, JSON.stringify(plan), collectionQueryData("order-plans", plan));
    },
    async saveOrderPlanAttachments(number, collectedAt, attachments) {
      await saveOrderPlanAttachments.run(JSON.stringify(attachments), number, collectedAt);
    },
    async findNoticesForOrderPlan(number) {
      return await findNoticesForOrderPlan.all(number) as NoticeKey[];
    },
    async replaceOrderPlan(plan) {
      await replaceOrderPlan.run(plan.number, plan.collectedAt, JSON.stringify(plan), collectionQueryData("order-plans", plan));
    },
    async findPriorSpec(number) {
      const row = await findPriorSpec.get(number);
      return row ? JSON.parse(String(row.data)) as PriorSpec : null;
    },
    async savePriorSpec(spec) {
      await savePriorSpec.run(spec.number, spec.collectedAt, JSON.stringify(spec), collectionQueryData("prior-specs", spec));
    },
  };
}

