import type { DatabaseSync } from "node:sqlite";
import type { OpeningResultQuery } from "@/entities/opening-result/model/opening-result";
import { getNoticeOrderPlanNumber } from "@/entities/order-plan/model/order-plan";
import type { G2bCollectionCounts } from "./types";
import { openNoticeList } from "./notice-list";
import { openOrderPlanList } from "./order-plan-list";
import { openContractRequestList } from "./contract-request-list";
import { openPriorSpecList } from "./prior-spec-list";
import { openOpeningResultList } from "./opening-result-list";
import { openContractList } from "./contract-list";
import { cleanText } from "./collection-list-query";
import type { CollectionDiagnostic } from "@/shared/api/g2b/collection-diagnostic";

export type CollectionSection = keyof G2bCollectionCounts;

// 저장 키와 재시도에 필요한 입력을 업무별로 함께 보존한다.
export type CollectionTarget = { number: string } & (
  | { section: "order-plans" | "prior-specs" }
  | { section: "contracts" | "contract-requests"; revision: string }
  | { section: "notices"; revision: string; methodCode: string }
  | { section: "opening-results"; revision: string; openingRevision: string; queries: OpeningResultQuery[] }
);

type FinishedStatus = "succeeded" | "failed" | "deferred";
type AttemptStatus = "pending" | FinishedStatus;

type TargetKey = {
  number: string;
  revision: string;
  openingRevision: string;
};

type ListMetadata = {
  title: string | null;
  businessCode: string | null;
  businessLabel: string | null;
};

type SavedTarget = TargetKey & ListMetadata & { collectedAt: string };
type FailedAttempt = TargetKey & {
  id: number;
  startedAt: string;
  status: Exclude<AttemptStatus, "succeeded">;
  error: string | null;
  diagnostics: string | null;
  hasData: boolean;
};

export type CollectionOverview = {
  counts: { total: number; collected: number; uncollected: number };
  saved: SavedTarget[];
  failures: FailedAttempt[];
};

export type CollectionListRow = TargetKey & ListMetadata & {
  collectedAt: string | null;
  id: number | null;
  startedAt: string | null;
  status: AttemptStatus | null;
  error: string | null;
  diagnostics: string | null;
};

type RetryRow = { input: string; status: AttemptStatus; latestId: number };

// 저장된 계획으로 연결되는 호출 번호만 합친다. 서로 다른 계획에 연결되면 원래 이력 번호를 유지한다.
const orderPlanAttemptKeys = `
  order_plan_links AS (
    SELECT notice_order_plan_lookup(data) AS lookup_number,
      json_extract(data, '$.orderPlanNumber') AS plan_number
    FROM notices
    WHERE json_type(data, '$.orderPlanNumber') = 'text'
  ),
  unique_order_plan_links AS (
    SELECT lookup_number, MIN(plan_number) AS plan_number
    FROM order_plan_links
    WHERE lookup_number IS NOT NULL
    GROUP BY lookup_number
    HAVING COUNT(DISTINCT plan_number) = 1
      AND MIN(plan_number) <> lookup_number
  ),
  order_plan_aliases AS (
    SELECT lookup_number, plan_number
    FROM unique_order_plan_links
    JOIN order_plans ON order_plans.number = plan_number
    WHERE NOT EXISTS (SELECT 1 FROM order_plans WHERE number = lookup_number)
  ),
  order_plan_attempt_keys AS (
    SELECT attempt.id, COALESCE(alias.plan_number, attempt.number) AS number,
      attempt.revision, attempt.opening_revision
    FROM g2b_collection_attempts attempt
    LEFT JOIN order_plan_aliases alias ON alias.lookup_number = attempt.number
    WHERE attempt.section = 'order-plans'
  )`;

// 상세 화면과 같은 원본 필드에서 목록 제목과 업무구분을 읽는다.
// 빈 문자열은 해당 업무에 없는 차수를 뜻한다.
const savedQueries: Record<CollectionSection, string> = {
  "order-plans": `
    SELECT number, '' AS revision, '' AS opening_revision, collected_at,
      COALESCE(NULLIF(TRIM(json_extract(data, '$.payload.dlOderPlanM.bizNm')), ''),
        json_extract(data, '$.payload.dlOderPlanM.itemNm')) AS title,
      json_extract(data, '$.payload.dlOderPlanM.prcmBsneSeCd') AS businessCode,
      json_extract(data, '$.payload.dlOderPlanM.prcmBsneSeCdNm') AS businessLabel,
      data
    FROM order_plans`,
  "prior-specs": `
    SELECT number, '' AS revision, '' AS opening_revision, collected_at,
      json_extract(data, '$.payload.dlBfSpecM.bfSpecNm') AS title,
      json_extract(data, '$.payload.dlBfSpecM.prcmBsneSeCd') AS businessCode,
      json_extract(data, '$.payload.dlBfSpecM.prcmBsneSeCdNm') AS businessLabel,
      data
    FROM prior_specs`,
  notices: `
    SELECT number, revision, '' AS opening_revision, collected_at,
      json_extract(data, '$.title') AS title,
      COALESCE(json_extract(data, '$.payload.dlUntyBidPbancM.prcmBsneSeCd'),
        json_extract(data, '$.payload.dmItemMap.prcmBsneSeCd')) AS businessCode,
      json_extract(data, '$.payload.dmItemMap.prcmBsneSeNm') AS businessLabel,
      data
    FROM notices`,
  "contract-requests": `
    SELECT number, revision, '' AS opening_revision, collected_at,
      json_extract(data, '$.detail.bizNm') AS title,
      NULL AS businessCode,
      json_extract(data, '$.detail.prcmBsneAreaNm') AS businessLabel,
      data
    FROM contract_requests`,
  contracts: `
    SELECT number, revision, '' AS opening_revision, collected_at,
      json_extract(data, '$.detail.ctrtNm') AS title,
      json_extract(data, '$.detail.prcmBsneSeCd') AS businessCode,
      json_extract(data, '$.detail.prcmBsneSeNm') AS businessLabel,
      data
    FROM contracts`,
  "opening-results": `
    SELECT result.number, result.revision, result.opening_revision, result.collected_at,
      COALESCE(NULLIF(TRIM(json_extract(notice.data, '$.title')), ''),
        NULLIF(TRIM(json_extract(result.data, '$.price.pbancInfo.bidPbancNm')), ''),
        (SELECT COALESCE(
          NULLIF(TRIM(json_extract(entry.value, '$.detail.bidPbancNm')), ''),
          NULLIF(TRIM(json_extract(entry.value, '$.detail.bidPrgrs.bidPbancNm')), ''),
          NULLIF(TRIM(json_extract(entry.value, '$.detail.bidInfo.bidPbancNm')), '')
        ) AS name FROM json_each(result.data, '$.results') AS entry
        WHERE name IS NOT NULL LIMIT 1)
      ) AS title,
      COALESCE(NULLIF(TRIM(json_extract(notice.data, '$.payload.dmItemMap.prcmBsneSeCd')), ''),
        (SELECT MIN(json_extract(entry.value, '$.query.businessCode'))
          FROM json_each(result.data, '$.results') AS entry
          HAVING COUNT(DISTINCT json_extract(entry.value, '$.query.businessCode')) = 1)
      ) AS businessCode,
      json_extract(notice.data, '$.payload.dmItemMap.prcmBsneSeNm') AS businessLabel,
      result.data,
      json_extract(notice.data, '$.payload.dmItemMap.dmstUntyGrpNm') AS linkedAgency
    FROM opening_results AS result
    LEFT JOIN notices AS notice ON notice.number = result.number AND notice.revision = result.revision`,
};

/**
 * 업무별 저장 결과와 시도 이력을 같은 SQLite 연결에서 조회하고 갱신한다.
 * 기존 시도 이력을 보존하며 누락된 진단 열을 추가한다.
 * @throws 스키마 초기화 또는 쿼리 준비에 실패한 경우.
 */
export function openCollectionAttempts(db: DatabaseSync) {
  db.function("notice_order_plan_lookup", { deterministic: true }, (data) => {
    if (typeof data !== "string") return null;
    const payload = JSON.parse(data)?.payload;
    return payload ? getNoticeOrderPlanNumber(payload) ?? null : null;
  });
  db.exec(`
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
      diagnostics TEXT
    );
    CREATE INDEX IF NOT EXISTS g2b_collection_attempts_target
      ON g2b_collection_attempts (section, number, revision, opening_revision, id DESC);
  `);
  // 동시에 시작한 프로세스도 열 확인과 추가를 쓰기 트랜잭션에서 직렬화한다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('g2b_collection_attempts') WHERE name = 'diagnostics'").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!db.prepare("SELECT 1 FROM pragma_table_info('g2b_collection_attempts') WHERE name = 'diagnostics'").get()) {
        db.exec("ALTER TABLE g2b_collection_attempts ADD COLUMN diagnostics TEXT");
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const insert = db.prepare(`
    INSERT INTO g2b_collection_attempts (section, number, revision, opening_revision, input, started_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const finish = db.prepare(`
    UPDATE g2b_collection_attempts SET finished_at = ?, status = ?, error = ?, diagnostics = ?
    WHERE id = ? AND status = 'pending'
  `);
  const retry = db.prepare(`
    SELECT input, status, (
      SELECT MAX(latest.id) FROM g2b_collection_attempts latest
      WHERE latest.section = attempt.section AND latest.number = attempt.number
        AND latest.revision = attempt.revision AND latest.opening_revision = attempt.opening_revision
    ) AS latestId
    FROM g2b_collection_attempts attempt WHERE attempt.id = ?
  `);
  const retryOrderPlan = db.prepare(`
    WITH ${orderPlanAttemptKeys}
    SELECT target.number, MAX(latest.id) AS latestId
    FROM order_plan_attempt_keys target
    JOIN order_plan_attempt_keys latest USING (number, revision, opening_revision)
    WHERE target.id = ?
    GROUP BY target.number
  `);
  const summaries = new Map(Object.entries(savedQueries).map(([section, savedQuery]) => {
    // 두 화면에서 저장 자료와 시도 이력의 합집합을 동일한 기준으로 집계한다.
    const orderPlans = section === "order-plans";
    const targets = `
      WITH ${orderPlans ? `${orderPlanAttemptKeys},` : ""} saved AS (${savedQuery}),
      latest AS (
        SELECT MAX(id) AS id, number, revision, opening_revision
        FROM ${orderPlans ? "order_plan_attempt_keys" : "g2b_collection_attempts"}
        WHERE ${orderPlans ? "? = 'order-plans'" : "section = ?"}
        GROUP BY number, revision, opening_revision
      ),
      targets AS (
        SELECT number, revision, opening_revision FROM saved
        UNION SELECT number, revision, opening_revision FROM latest
      )`;
    const counts = db.prepare(`${targets}
      SELECT COUNT(*) AS total, (SELECT COUNT(*) FROM saved) AS collected,
        COUNT(*) - (SELECT COUNT(*) FROM saved) AS uncollected
      FROM targets
    `);
    const overview = db.prepare(`${targets}
      SELECT targets.number, targets.revision, targets.opening_revision AS openingRevision,
        saved.collected_at AS collectedAt, saved.title,
        CAST(saved.businessCode AS TEXT) AS businessCode, saved.businessLabel,
        attempt.id, attempt.started_at AS startedAt,
        attempt.status, attempt.error, attempt.diagnostics
      FROM targets
      LEFT JOIN saved USING (number, revision, opening_revision)
      LEFT JOIN latest USING (number, revision, opening_revision)
      LEFT JOIN g2b_collection_attempts attempt ON attempt.id = latest.id
      ORDER BY saved.collected_at DESC, targets.number, targets.revision, targets.opening_revision
    `);
    return [section, { counts, overview, targets }] as const;
  }));

  db.function("collection_search_text", { deterministic: true }, (value) => cleanText(value).toLowerCase());
  return {
    noticeList: openNoticeList(db, summaries.get("notices")!.targets),
    orderPlanList: openOrderPlanList(db, summaries.get("order-plans")!.targets),
    contractRequestList: openContractRequestList(db, summaries.get("contract-requests")!.targets),
    priorSpecList: openPriorSpecList(db, summaries.get("prior-specs")!.targets),
    openingResultList: openOpeningResultList(db, summaries.get("opening-results")!.targets),
    contractList: openContractList(db, summaries.get("contracts")!.targets),
    /**
     * 외부 조회 직전에 입력과 시작 시각을 기록한다.
     * @returns 종료 결과를 기록하거나 재시도할 때 쓰는 시도 ID.
     * @throws SQLite가 이력 행을 저장하지 못한 경우.
     */
    start(target: CollectionTarget): number {
      return Number(insert.run(
        target.section,
        target.number,
        "revision" in target ? target.revision : "",
        "openingRevision" in target ? target.openingRevision : "",
        JSON.stringify(target),
        new Date().toISOString(),
      ).lastInsertRowid);
    },

    /**
     * 지정한 시도만 종료 처리한다. 다른 시도의 시작 순서와 결과는 보존된다.
     * @throws SQLite가 결과를 저장하지 못한 경우.
     */
    finish(id: number, status: FinishedStatus, error: string | null = null, diagnostics?: CollectionDiagnostic): void {
      finish.run(new Date().toISOString(), status, error, diagnostics ? JSON.stringify(diagnostics) : null, id);
    },

    /**
     * 대상의 최신 실패·보류·미확인 이력에서 재수집 입력을 읽는다.
     * 발주계획 호출 번호가 저장 번호로 연결되면 그 저장 번호로 직접 재수집한다.
     * @returns 없는 이력은 missing, 이미 성공했거나 새 시도가 시작됐으면 conflict.
     * @throws SQLite 조회나 저장 입력 역직렬화가 실패한 경우.
     */
    retryTarget(id: number): CollectionTarget | "missing" | "conflict" {
      const row = retry.get(id) as RetryRow | undefined;
      if (!row) return "missing";
      if (row.status === "succeeded") return "conflict";
      const target = JSON.parse(row.input) as CollectionTarget;
      if (target.section === "order-plans") {
        const resolved = retryOrderPlan.get(id) as { number: string; latestId: number } | undefined;
        return resolved?.latestId === id ? { ...target, number: resolved.number } : "conflict";
      }
      return row.latestId === id ? target : "conflict";
    },

    /**
     * 목록 본문을 읽지 않고 랜딩 카드의 전체·수집·미수집 건수를 조회한다.
     * @throws SQLite가 수집 건수를 집계하지 못한 경우.
     */
    counts(section: CollectionSection): CollectionOverview["counts"] {
      const { total, collected, uncollected } = summaries.get(section)!.counts.get(section) as CollectionOverview["counts"];
      return { total, collected, uncollected };
    },

    /**
     * 저장 키와 시도 키의 합집합으로 집계하고 최신 실패와 미확인 시도를 함께 반환한다.
     * @throws SQLite가 목록을 조회하지 못한 경우.
     */
    overview(section: CollectionSection): CollectionOverview {
      const rows = summaries.get(section)!.overview.all(section) as CollectionListRow[];
      const saved: SavedTarget[] = [];
      const failures: FailedAttempt[] = [];
      for (const { number, revision, openingRevision, collectedAt, title, businessCode, businessLabel, id, startedAt, status, error, diagnostics } of rows) {
        const key = { number, revision, openingRevision };
        if (collectedAt !== null) saved.push({ ...key, collectedAt, title, businessCode, businessLabel });
        if (id !== null && startedAt !== null && status && status !== "succeeded") {
          failures.push({ ...key, id, startedAt, status, error, diagnostics, hasData: collectedAt !== null });
        }
      }
      failures.sort((first, second) => second.id - first.id);
      return {
        counts: { total: rows.length, collected: saved.length, uncollected: rows.length - saved.length },
        saved,
        failures,
      };
    },
  };
}
