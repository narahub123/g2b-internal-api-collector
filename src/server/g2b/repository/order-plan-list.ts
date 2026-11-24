import { numberSearchSource, withNumberSearch } from "./number-search";
import type { CollectionListRow } from "./collection-attempts";
import { budgetPageSql } from "./budget-range-page";
import { COLLECTION_LIST_PAGE_SIZE as pageSize } from "@/shared/config/collection-list";
import type { G2bDatabase, SQLInputValue } from "./database";
import type { CollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { appendCollectionDateRange, cleanText, searchText, sortDate } from "./collection-list-query";

/** 수집 원본에서 목록 검색과 정렬에 필요한 파생값을 계산한다. */
export function orderPlanFields(data: unknown) {
  const detail = typeof data === "string" ? JSON.parse(data)?.payload?.dlOderPlanM : undefined;
  const business = resolveG2bBusiness(detail?.prcmBsneSeCd, detail?.prcmBsneSeCdNm);
  // 상세에서 노출되는 원화 예산만 비교한다. 외자의 달러 환산액은 원화 범위에 포함하지 않는다.
  const code = business?.code;
  const longTerm = code === "07" && detail?.wtoYn !== "Y" && detail?.newLotmSeCd === "신120002";
  const rawBudget = code === "01" || code === "10" ? detail?.prchsPrnmntAmt
    : code === "03" || code === "05" ? detail?.srvBgtAmt
    : code === "07" ? (longTerm ? detail?.tlbkpngAmt : detail?.oderSumAmt) : undefined;
  const budget = typeof rawBudget === "number" ||
    (typeof rawBudget === "string" && /^[+-]?\d+(?:\.\d+)?$/.test(rawBudget.trim()))
    ? Number(rawBudget) : null;
  return JSON.stringify({
    business: business?.code ?? business?.label ?? null,
    released: sortDate(detail?.releaseDt),
    agency: cleanText(detail?.oderInstNm),
    budget: Number.isFinite(budget) ? budget : null,
  });
}

/**
 * 발주계획 저장 자료와 최신 수집 시도에서 목록 옵션 및 페이지를 조회한다.
 * @param db 발주계획 파생 목록과 원본을 읽는 DB 연결.
 * @returns 선택지와 페이지를 조회하는 함수.
 */
export function openOrderPlanList(db: G2bDatabase) {
  // 사용 중인 코드와 라벨 조합만 읽어 기존 표시 규칙을 적용한다.
  const businesses = db.prepare(`SELECT json_extract(pair, '$[0]') AS code, json_extract(pair, '$[1]') AS label
    FROM g2b_order_plan_list_businesses WHERE uses > 0`);

  return {
    /**
     * 저장 자료의 업무구분을 목록 배지와 같은 이름으로 반환한다.
     * @throws Turso에서 업무구분을 조회하지 못한 경우.
     */
    async businesses() {
      const options = new Map<string, string>();
      for (const row of await businesses.all()) {
        const business = resolveG2bBusiness(row.code, row.label);
        if (business) options.set(business.code ?? business.label, business.label);
      }
      return [...options].map(([value, label]) => ({ value, label }))
        .sort((first, second) => first.label.localeCompare(second.label, "ko"));
    },

    /**
     * 발주계획의 검색·필터를 적용한 건수와 선택 상태의 페이지를 반환한다.
     * @param query 화면에서 검증한 검색·필터·정렬과 페이지 조건.
     * @returns 노출된 목록의 건수와 선택 페이지.
     * @throws Turso에서 검색 또는 집계에 실패한 경우.
     */
    async page(query: CollectionListQuery) {
      const where: string[] = [];
      const values: SQLInputValue[] = [];
      if (query.search.query) {
        const column = query.search.field === "number" ? "lower(number)"
          : query.search.field === "agency" ? "agency" : "sortTitle";
        where.push(`instr(${column}, ?) > 0`);
        values.push(searchText(query.search.query));
      }
      // 공개일 범위는 일시 열을 그대로 비교해 기존 인덱스로 탐색한다.
      appendCollectionDateRange(where, values, "released", query.filters.released);
      // 예산 범위는 지정한 경계만 포함 비교한다.
      const budget = query.filters.budget;
      if (budget && ("from" in budget || "to" in budget)) {
        // 하한과 같거나 큰 예산을 선택한다.
        if (budget.from !== undefined) {
          where.push("budget >= ?");
          values.push(budget.from);
        }
        // 상한과 같거나 작은 예산을 선택한다.
        if (budget.to !== undefined) {
          where.push("budget <= ?");
          values.push(budget.to);
        }
      }
      const selected = query.filters.business;
      if (Array.isArray(selected) && selected.length) {
        where.push("json_extract(fields, '$.business') IN (SELECT value FROM json_each(?))");
        values.push(JSON.stringify(selected));
      }
      const [field, direction] = query.sort.split("-");
      // 검증된 정렬 선택을 공개일시 또는 정규화 사업명으로 연결한다.
      const order = field === "title" ? "sortTitle" : "released";
      const ascending = direction === "asc";
      // 기본 날짜순 예산 단독 요청만 범위에 따라 페이지 조회 경로를 고른다.
      const adaptiveBudget = order === "released" && !ascending && where.length > 0 && where.every((clause) => clause.startsWith("budget "));
      // 결합 필터와 다른 정렬은 예산 인덱스 도입 전의 후보 탐색을 유지한다.
      const filters = adaptiveBudget ? where : where.map((clause) => clause.startsWith("budget ") ? "+" + clause : clause);
      const criteria = ["visible = 1", ...filters].join(" AND ");
      const sortDirection = ascending ? "ASC NULLS LAST" : "DESC";
      // 기본 날짜 오름차순은 빈 날짜가 마지막에 오도록 인덱스와 같은 순서로 후보를 읽는다.
      const pageOrder = order === "released" && ascending
        ? "(released IS NULL) ASC, released ASC"
        : `${order} ${sortDirection}`;
      const status = query.status === "collected" ? "collected_at IS NOT NULL"
        : query.status === "uncollected" ? "collected_at IS NULL" : "TRUE";
      // 번호 검색만 후보를 좁히고 기존 필터를 통과한 행을 같은 스냅샷에서 조회한다.
      const keyword = query.search.field === "number" ? query.search.query : "";
      /**
       * 선택된 번호 조각으로 이 업무의 건수와 요청 페이지를 조회한다.
       * @param grams 번호 검색의 출처별 조각. 비어 있으면 기존 목록을 읽는다.
       * @returns 상태별 건수와 페이지 데이터.
       */
      return withNumberSearch(db, "order-plans", keyword, async (grams) => {
        // 후보 제한이 가능하면 동일한 일치 집합을 집계와 페이지에 전달한다.
        const source = numberSearchSource("order-plans", grams, criteria, values);
        // 기본 조회는 사전 집계 한 행을 사용하고 검색·필터 조회는 조건에 맞는 키를 센다.
        const totals = where.length
          ? `SELECT COUNT(*) AS total, COUNT(collected_at) AS collected FROM ${source.filtered}`
          : "SELECT total, collected FROM g2b_collection_list_counts WHERE section = 'order-plans' AND scope = 'all'";
        const selectedCountSql = query.status === "collected" ? "collected" : query.status === "uncollected" ? "total - collected" : "total";
        // 정렬과 페이지 경계를 먼저 확정해 원본 발주계획과 최신 시도는 선택한 키에 한해서 조회한다.
        const defaultPage = `paged AS MATERIALIZED (
            SELECT number, revision, opening_revision, collected_at, latest_id, ${order} AS sortValue
            FROM ${source.page} ${status}
            ORDER BY ${pageOrder}, number, revision, opening_revision
            LIMIT ${pageSize} OFFSET (
              SELECT (max(1, min(?, ((${selectedCountSql}) + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} FROM totals
            )
          )`;
        // 좁은 예산은 예산 인덱스로 탐색하고 넓은 예산은 기존 날짜 인덱스 순서대로 읽는다.
        const dateIndex = query.status === "collected" ? "collected"
          : query.status === "uncollected" ? "uncollected" : "released";
        // 넓은 범위에서도 수집 상태별 부분 인덱스로 관련 행만 읽는다.
        const budgetPage = adaptiveBudget ? budgetPageSql(
          "order-plans", "g2b_order_plan_list INDEXED BY g2b_order_plan_list_budget",
          `g2b_order_plan_list INDEXED BY g2b_order_plan_list_${dateIndex}`, "released", criteria, status, selectedCountSql,
        ) : "";
        // 두 페이지 경로는 기존 표시 순서와 응답 조립을 공유한다.
        const sql = `WITH ${source.prefix}totals AS MATERIALIZED (${totals}), ${adaptiveBudget ? budgetPage : defaultPage}
          SELECT paged.number, paged.revision, paged.opening_revision AS openingRevision,
            paged.collected_at AS collectedAt, COALESCE(NULLIF(TRIM(json_extract(saved.data, '$.payload.dlOderPlanM.bizNm')), ''), json_extract(saved.data, '$.payload.dlOderPlanM.itemNm')) AS title,
            CAST(json_extract(saved.data, '$.payload.dlOderPlanM.prcmBsneSeCd') AS TEXT) AS businessCode,
            json_extract(saved.data, '$.payload.dlOderPlanM.prcmBsneSeCdNm') AS businessLabel,
            attempt.id, attempt.started_at AS startedAt, attempt.status, attempt.error, paged.sortValue,
            totals.total, totals.collected, ${selectedCountSql} AS selectedCount, attempt.diagnostics
          FROM totals LEFT JOIN paged ON TRUE
          LEFT JOIN order_plans saved ON paged.collected_at IS NOT NULL AND saved.number = paged.number
          LEFT JOIN g2b_collection_attempts attempt ON attempt.id = paged.latest_id
          ORDER BY paged.sortValue ${sortDirection}, paged.number, paged.revision, paged.opening_revision`;
        // 조건 인자를 집계와 페이지에 각각 전달한 뒤 빈 목록에서도 반환되는 집계 행을 사용한다.
        const args = source.args ? [...source.args, query.page] : adaptiveBudget ? [...values, query.page, "all", ...values, ...values] : [...values, ...values, query.page];
        const rows = await db.prepare(sql).all(...args) as
          (CollectionListRow & { total: number; collected: number; selectedCount: number })[];
        const { total, collected, selectedCount } = rows[0];
        const totalPages = Math.ceil(selectedCount / pageSize);
        // 기존 응답 구조를 유지하고 집계용 빈 행은 목록에서 제외한다.
        return {
          counts: { total, collected, uncollected: total - collected },
          page: Math.max(1, Math.min(query.page, totalPages)),
          totalPages,
          rows: rows.filter((row) => row.number !== null),
        };
      });
    },
  };
}
