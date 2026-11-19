import type { G2bDatabase } from "./database";
import type { OpeningResultQuery } from "@/entities/opening-result/model/opening-result";
import {
  orderPlanLinkPredicate, orderPlanLookupSql, orderPlanNumberSql, orderPlanUnavailablePredicate,
} from "./order-plan-notice-sql";
import { priorSpecUnavailableStatus } from "@/shared/config/g2b-prior-spec";
import type { G2bCollectionCounts } from "./types";
import { openNoticeList } from "./notice-list";
import { openOrderPlanList } from "./order-plan-list";
import { openContractRequestList } from "./contract-request-list";
import { openPriorSpecList } from "./prior-spec-list";
import { openOpeningResultList } from "./opening-result-list";
import { openContractList } from "./contract-list";
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

type RetryRow = { input: string; status: AttemptStatus; latestId: number; startedAt: string };

// 저장된 계획으로 연결되는 호출 번호만 합친다. 서로 다른 계획에 연결되면 원래 이력 번호를 유지한다.
export const orderPlanAttemptKeys = `
  unique_order_plan_links AS (
    SELECT ${orderPlanLookupSql} AS lookup_number, MIN(${orderPlanNumberSql}) AS plan_number
    FROM notices
    WHERE ${orderPlanLinkPredicate}
    GROUP BY ${orderPlanLookupSql}
    HAVING MIN(${orderPlanNumberSql}) = MAX(${orderPlanNumberSql})
      AND plan_number <> lookup_number
  ),
  order_plan_aliases AS (
    SELECT lookup_number, plan_number
    FROM unique_order_plan_links
    JOIN order_plans AS saved ON saved.number = plan_number
    LEFT JOIN order_plans AS original ON original.number = lookup_number
    WHERE original.number IS NULL
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
      data, query_data, json_extract(query_data, '$.searchTitle') AS searchTitle
    FROM order_plans`,
  "prior-specs": `
    SELECT number, '' AS revision, '' AS opening_revision, collected_at,
      json_extract(data, '$.payload.dlBfSpecM.bfSpecNm') AS title,
      json_extract(data, '$.payload.dlBfSpecM.prcmBsneSeCd') AS businessCode,
      json_extract(data, '$.payload.dlBfSpecM.prcmBsneSeCdNm') AS businessLabel,
      data, query_data, json_extract(query_data, '$.searchTitle') AS searchTitle
    FROM prior_specs`,
  notices: `
    SELECT number, revision, '' AS opening_revision, collected_at,
      json_extract(data, '$.title') AS title,
      COALESCE(json_extract(data, '$.payload.dlUntyBidPbancM.prcmBsneSeCd'),
        json_extract(data, '$.payload.dmItemMap.prcmBsneSeCd')) AS businessCode,
      json_extract(data, '$.payload.dmItemMap.prcmBsneSeNm') AS businessLabel,
      data, query_data, json_extract(query_data, '$.searchTitle') AS searchTitle
    FROM notices WHERE json_valid(data)`,
  "contract-requests": `
    SELECT number, revision, '' AS opening_revision, collected_at,
      json_extract(data, '$.detail.bizNm') AS title,
      NULL AS businessCode,
      json_extract(data, '$.detail.prcmBsneAreaNm') AS businessLabel,
      data, query_data, json_extract(query_data, '$.searchTitle') AS searchTitle
    FROM contract_requests`,
  contracts: `
    SELECT number, revision, '' AS opening_revision, collected_at,
      json_extract(data, '$.detail.ctrtNm') AS title,
      json_extract(data, '$.detail.prcmBsneSeCd') AS businessCode,
      json_extract(data, '$.detail.prcmBsneSeNm') AS businessLabel,
      data, query_data, json_extract(query_data, '$.searchTitle') AS searchTitle
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
        (SELECT CASE WHEN COUNT(DISTINCT json_extract(entry.value, '$.query.businessCode')) = 1
          THEN MIN(json_extract(entry.value, '$.query.businessCode')) END
          FROM json_each(result.data, '$.results') AS entry)
      ) AS businessCode,
      json_extract(notice.data, '$.payload.dmItemMap.prcmBsneSeNm') AS businessLabel,
      result.data, result.query_data,
      COALESCE(json_extract(notice.query_data, '$.openingSearchTitle'), json_extract(result.query_data, '$.searchTitle')) AS searchTitle,
      json_extract(notice.query_data, '$.linkedAgency') AS linkedAgency,
      json_extract(notice.query_data, '$.linkedCode') AS linkedCode,
      json_extract(notice.query_data, '$.linkedBusiness') AS linkedBusiness
    FROM opening_results AS result
    LEFT JOIN notices AS notice ON notice.number = result.number AND notice.revision = result.revision
      AND json_valid(notice.data)`,
};

/**
 * 업무별 저장 결과와 시도 이력을 같은 SQLite 연결에서 조회하고 갱신한다.
 * 기존 시도 이력을 보존하며 누락된 진단 열을 추가한다.
 * @throws 스키마 초기화 또는 쿼리 준비에 실패한 경우.
 */
export function openCollectionAttempts(db: G2bDatabase) {
  const insert = db.prepare(`
    INSERT INTO g2b_collection_attempts (section, number, revision, opening_revision, input, started_at, job_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const finish = db.prepare(`
    UPDATE g2b_collection_attempts SET finished_at = ?, status = ?, error = ?, diagnostics = ?, attachment_number = ?
    WHERE id = ? AND status = 'pending'
  `);
  const retry = db.prepare(`
    SELECT input, status, started_at AS startedAt, (
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
  // 조회 불가 판정은 연결을 적용한 시도 키에만 적용한다. 저장된 계획은 항상 포함한다.
  const unavailableOrderPlans = `(
    SELECT ${orderPlanLookupSql} FROM notices WHERE ${orderPlanUnavailablePredicate}
  )`;
  const orderPlanCounts = db.prepare(`
    WITH attempt_keys AS (
      SELECT DISTINCT number, revision, opening_revision
      FROM g2b_collection_attempts
      WHERE section = 'order-plans'
    ),
    -- 시도 번호의 인덱스 범위에서 양 끝만 읽고, 뒤에서 두 값을 비교할 때 탐색을 반복하지 않는다.
    -- 단항 +는 번호 값은 유지하면서 TEXT 친화도를 제거해 JSON 표현식 인덱스의 동등 탐색을 허용한다.
    link_bounds AS MATERIALIZED (
      SELECT attempt.*, original.number AS original_number,
        (SELECT ${orderPlanNumberSql} FROM notices
          WHERE ${orderPlanLinkPredicate} AND ${orderPlanLookupSql} = +attempt.number
          ORDER BY ${orderPlanNumberSql} ASC LIMIT 1) AS first_plan,
        (SELECT ${orderPlanNumberSql} FROM notices
          WHERE ${orderPlanLinkPredicate} AND ${orderPlanLookupSql} = +attempt.number
          ORDER BY ${orderPlanNumberSql} DESC LIMIT 1) AS last_plan
      FROM attempt_keys AS attempt
      LEFT JOIN order_plans AS original ON original.number = attempt.number
      WHERE original.number IS NULL OR attempt.revision <> '' OR attempt.opening_revision <> ''
    ),
    normalized_keys AS (
      SELECT DISTINCT
        CASE WHEN bounds.original_number IS NULL AND bounds.first_plan = bounds.last_plan
          THEN COALESCE(linked.number, bounds.number) ELSE bounds.number END AS number,
        bounds.revision, bounds.opening_revision
      FROM link_bounds AS bounds
      LEFT JOIN order_plans AS linked ON linked.number = bounds.first_plan
    ),
    collected AS (SELECT COUNT(*) AS count FROM order_plans),
    uncollected AS (
      SELECT COUNT(*) AS count
      FROM normalized_keys AS target
      LEFT JOIN order_plans AS saved
        ON saved.number = target.number AND target.revision = '' AND target.opening_revision = ''
      WHERE saved.number IS NULL AND NOT EXISTS (
        SELECT 1 FROM notices
        WHERE ${orderPlanUnavailablePredicate} AND ${orderPlanLookupSql} = target.number
      )
    )
    SELECT collected.count + uncollected.count AS total,
      collected.count AS collected, uncollected.count AS uncollected
    FROM collected CROSS JOIN uncollected
  `);
  // 입찰공고 카드 집계만 별도 계산한다. 목록 overview의 공통 targets는 유지한다.
  const noticeCounts = db.prepare(`
    WITH attempt_keys AS (
      SELECT DISTINCT number, revision, opening_revision
      FROM g2b_collection_attempts
      WHERE section = 'notices'
    ),
    collected AS (
      SELECT COUNT(*) AS n FROM notices WHERE json_valid(data)
    ),
    uncollected AS (
      SELECT COUNT(*) AS n FROM attempt_keys AS a
      WHERE NOT EXISTS (
        SELECT 1 FROM notices AS s
        WHERE s.number = a.number AND s.revision = a.revision
          AND a.opening_revision = '' AND json_valid(s.data)
      )
    )
    SELECT collected.n + uncollected.n AS total,
      collected.n AS collected, uncollected.n AS uncollected
    FROM collected CROSS JOIN uncollected
  `);
  // 양쪽의 복합 키는 NOT NULL이다. 저장 여부만 확인하므로 공고 원본을 읽지 않는다.
  const openingResultCounts = db.prepare(`
    WITH attempt_keys AS (
      SELECT number, revision, opening_revision
      FROM g2b_collection_attempts
      WHERE section = ?
      GROUP BY number, revision, opening_revision
    ),
    counts AS MATERIALIZED (
      SELECT (SELECT COUNT(*) FROM opening_results) AS collected,
        (SELECT COUNT(*) FROM attempt_keys
          WHERE (number, revision, opening_revision) NOT IN (
            SELECT number, revision, opening_revision FROM opening_results
          )) AS uncollected
    )
    SELECT collected + uncollected AS total, collected, uncollected FROM counts
  `);
  // 계약요청·계약 카드 집계 전용 SQL. 목록 overview의 UNION 경로는 유지한다.
  // GROUP BY로 중복 시도를 제거하고 NOT IN으로 미저장 키만 센다.
  const contractRequestCounts = db.prepare(`
    WITH attempt_keys AS (
      SELECT number, revision, opening_revision
      FROM g2b_collection_attempts
      WHERE section = 'contract-requests'
      GROUP BY number, revision, opening_revision
    ),
    counts AS MATERIALIZED (
      SELECT (SELECT COUNT(*) FROM contract_requests) AS collected,
        (SELECT COUNT(*) FROM attempt_keys
          WHERE (number, revision, opening_revision) NOT IN (
            SELECT number, revision, '' FROM contract_requests
          )) AS uncollected
    )
    SELECT collected + uncollected AS total, collected, uncollected FROM counts
  `);
  const contractCounts = db.prepare(`
    WITH attempt_keys AS (
      SELECT number, revision, opening_revision
      FROM g2b_collection_attempts
      WHERE section = 'contracts'
      GROUP BY number, revision, opening_revision
    ),
    counts AS MATERIALIZED (
      SELECT (SELECT COUNT(*) FROM contracts) AS collected,
        (SELECT COUNT(*) FROM attempt_keys
          WHERE (number, revision, opening_revision) NOT IN (
            SELECT number, revision, '' FROM contracts
          )) AS uncollected
    )
    SELECT collected + uncollected AS total, collected, uncollected FROM counts
  `);
  const summaries = new Map(Object.entries(savedQueries).map(([section, savedQuery]) => {
    // 두 화면에서 저장 자료와 시도 이력의 합집합을 동일한 기준으로 집계한다.
    const orderPlans = section === "order-plans";
    const priorSpecs = section === "prior-specs";
    // 조회 불가로 확인된 번호는 이력에서만 추가되는 목록 대상에서 제외한다.
    // 기존 공고에도 적용하도록 원본을 읽고 getNoticePriorSpecNumber와 같은 순서로 유효한 번호를 고른다.
    // SQLite의 기본 trim은 공백 문자만 제거하므로 JavaScript trim이 처리하는 문자도 명시한다.
    const trimChars = "char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)";
    const unavailablePriorSpecs = `unavailable_prior_spec_candidates AS (
      SELECT
        CASE WHEN json_type(data, '$.payload.dmItemMap.bfSpecRegNo') = 'text'
          THEN trim(json_extract(data, '$.payload.dmItemMap.bfSpecRegNo'), ${trimChars}) END AS detail_number,
        CASE WHEN json_type(data, '$.payload.dlBfSpecM.bfSpecRegNo') = 'text'
          THEN trim(json_extract(data, '$.payload.dlBfSpecM.bfSpecRegNo'), ${trimChars}) END AS spec_number
      FROM notices
      WHERE CASE WHEN json_valid(data)
        THEN json_extract(data, '$.priorSpecStatus') = '${priorSpecUnavailableStatus}'
      END
    ), unavailable_targets AS (
      SELECT DISTINCT COALESCE(
        CASE WHEN length(detail_number) BETWEEN 1 AND 30 AND detail_number NOT GLOB '*[^A-Z0-9-]*'
          AND instr(detail_number, char(0)) = 0 THEN detail_number END,
        CASE WHEN length(spec_number) BETWEEN 1 AND 30 AND spec_number NOT GLOB '*[^A-Z0-9-]*'
          AND instr(spec_number, char(0)) = 0 THEN spec_number END
      ) AS number
      FROM unavailable_prior_spec_candidates
    )`;
    const targets = `
      WITH ${orderPlans ? `${orderPlanAttemptKeys},` : ""}
      ${priorSpecs ? `${unavailablePriorSpecs},` : ""} saved AS (${savedQuery}),
      latest AS (
        SELECT MAX(id) AS id, number, revision, opening_revision
        FROM ${orderPlans ? "order_plan_attempt_keys" : "g2b_collection_attempts"}
        WHERE ${orderPlans ? "? = 'order-plans'" : "section = ?"}
        GROUP BY number, revision, opening_revision
      ),
      targets AS (
        SELECT number, revision, opening_revision FROM saved
        UNION SELECT number, revision, opening_revision FROM latest
        ${orderPlans ? `WHERE number NOT IN ${unavailableOrderPlans}` : ""}
        ${priorSpecs ? "WHERE number NOT IN (SELECT number FROM unavailable_targets WHERE number IS NOT NULL)" : ""}
      )`;
    const counts = orderPlans || section === "opening-results" || section === "notices" || section === "contract-requests" || section === "contracts" ? undefined : db.prepare(`${targets}
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

  return {
    noticeList: openNoticeList(db, summaries.get("notices")!.targets),
    orderPlanList: openOrderPlanList(db, summaries.get("order-plans")!.targets),
    contractRequestList: openContractRequestList(db, summaries.get("contract-requests")!.targets),
    priorSpecList: openPriorSpecList(db, summaries.get("prior-specs")!.targets),
    openingResultList: openOpeningResultList(db, summaries.get("opening-results")!.targets),
    contractList: openContractList(db, summaries.get("contracts")!.targets),
    /**
     * 외부 조회 직전에 입력과 시작 시각을 기록한다.
     * @param jobId 공고 워커가 시작한 경우 연결할 영속 작업 ID.
     * @returns 종료 결과를 기록하거나 재시도할 때 쓰는 시도 ID.
     * @throws Turso가 이력 행을 저장하지 못한 경우.
     */
    async start(target: CollectionTarget, jobId?: number): Promise<number> {
      return Number((await insert.run(
        target.section,
        target.number,
        "revision" in target ? target.revision : "",
        "openingRevision" in target ? target.openingRevision : "",
        JSON.stringify(target),
        new Date().toISOString(),
        jobId ?? null,
      )).lastInsertRowid);
    },

    /**
     * 지정한 시도만 종료 처리한다. 다른 시도의 시작 순서와 결과는 보존된다.
     * @param attachmentNumber 발주계획 요청 번호와 실제 저장 번호가 다를 때 첨부를 조회할 저장 번호.
     * @throws Turso가 결과를 저장하지 못한 경우.
     */
    async finish(id: number, status: FinishedStatus, error: string | null = null, diagnostics?: CollectionDiagnostic, attachmentNumber?: string): Promise<void> {
      await finish.run(new Date().toISOString(), status, error, diagnostics ? JSON.stringify(diagnostics) : null, attachmentNumber ?? null, id);
    },

    /**
     * 대상의 최신 실패·보류·미확인 이력에서 재수집 입력을 읽는다.
     * 발주계획 호출 번호가 저장 번호로 연결되면 그 저장 번호로 직접 재수집한다.
     * @param startedAt 조회한 이력의 시작 시각. 삭제 후 같은 ID가 재사용된 이력을 구분한다.
     * @returns 없는 이력은 missing, 이미 성공했거나 화면의 이력이 바뀌었으면 conflict.
     * @throws SQLite 조회나 저장 입력 역직렬화가 실패한 경우.
     */
    async retryTarget(id: number, startedAt?: string): Promise<CollectionTarget | "missing" | "conflict"> {
      const row = await retry.get(id) as RetryRow | undefined;
      if (!row) return "missing";
      if (row.status === "succeeded" || (startedAt !== undefined && row.startedAt !== startedAt)) return "conflict";
      const target = JSON.parse(row.input) as CollectionTarget;
      if (target.section === "order-plans") {
        const resolved = await retryOrderPlan.get(id) as { number: string; latestId: number } | undefined;
        return resolved?.latestId === id ? { ...target, number: resolved.number } : "conflict";
      }
      return row.latestId === id ? target : "conflict";
    },

    /**
     * 같은 공고·차수의 최신 시도가 실패했을 때 화면에 표시할 진단을 반환한다.
     * @throws Turso에서 수집 이력을 읽지 못한 경우.
     */
    async latestNoticeFailure(number: string, revision: string) {
      const row = await db.prepare(`SELECT status, error, diagnostics FROM g2b_collection_attempts
        WHERE section = 'notices' AND number = ? AND revision = ?
        ORDER BY id DESC LIMIT 1`).get(number, revision) as
        { status: string; error: string | null; diagnostics: string | null } | undefined;
      return row?.status === "failed" ? row : undefined;
    },

    /**
     * 목록 본문을 읽지 않고 랜딩 카드의 전체·수집·미수집 건수를 조회한다.
     * 발주계획은 중복 제거한 시도 키를 기준으로 공고 연결과 조회 불가 상태를 확인한다.
     * 개찰결과는 공고 원본에 접근하지 않고 저장 결과와 시도 이력의 복합 키만 비교한다.
     * @throws Turso가 수집 건수를 집계하지 못한 경우.
     */
    async counts(section: CollectionSection): Promise<CollectionOverview["counts"]> {
      const row = section === "notices"
        ? await noticeCounts.get()
        : section === "order-plans"
        ? await orderPlanCounts.get()
        : section === "opening-results"
        ? await openingResultCounts.get(section)
        : section === "contract-requests"
        ? await contractRequestCounts.get()
        : section === "contracts"
        ? await contractCounts.get()
        : await summaries.get(section)!.counts!.get(section);
      const { total, collected, uncollected } = row as CollectionOverview["counts"];
      return { total, collected, uncollected };
    },

    /**
     * 저장 키와 시도 키의 합집합으로 집계하고 최신 실패와 미확인 시도를 함께 반환한다.
     * @throws Turso가 목록을 조회하지 못한 경우.
     */
    async overview(section: CollectionSection): Promise<CollectionOverview> {
      const rows = await summaries.get(section)!.overview.all(section) as CollectionListRow[];
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
