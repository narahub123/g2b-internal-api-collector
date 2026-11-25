import { withBusinessKeys } from "./business-filter";
import { dateBucketPageSql, firstDateSeekPage, rangedDatePage } from "./date-bucket-page";
import { numberSearchSource, withListSearch } from "./number-search";
import type { CollectionListRow } from "./collection-attempts";
import { budgetPageSql } from "./budget-range-page";
import type { CollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import { COLLECTION_LIST_PAGE_SIZE as pageSize } from "@/shared/config/collection-list";
import type { G2bDatabase } from "./database";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { cleanText, collectionListCriteria, sortDate } from "./collection-list-query";

function asAmount(raw: unknown) {
  const value = typeof raw === "number" ||
    (typeof raw === "string" && /^[+-]?\d+(?:\.\d+)?$/.test(raw.trim())) ? Number(raw) : null;
  return Number.isFinite(value) ? value : null;
}

/** 수집 원본에서 목록 검색과 정렬에 필요한 파생값을 계산한다. */
export function priorSpecFields(raw: unknown, rawCode: unknown, rawLabel: unknown) {
  const data = typeof raw === "string" ? JSON.parse(raw) : null;
  const business = resolveG2bBusiness(rawCode, rawLabel);
  const businesses = business ? [business] : [];
  const detail = data?.payload?.dlBfSpecM;
  // 외자 상세의 달러 금액과 원화 금액을 같은 범위에서 비교하지 않는다.
  const foreign = business?.code === "02" || business?.code === "04";
  return JSON.stringify({
    date: sortDate(detail?.specRlsDt),
    agencies: [cleanText(detail?.dmstUntyGrpNm)].filter(Boolean),
    receipt: cleanText(detail?.bfSpecRegNo),
    businesses,
    budget: !foreign ? asAmount(detail?.alotBgtPrspAmt) : null,
    budgetUsd: foreign ? asAmount(detail?.alotBgtPrspAmt) : null,
  });
}

/**
 * 원화와 외자 예산을 각각 해당 통화의 필드와 비교한다.
 * @param range 활성 범위의 경계값을 바인딩하는 공통 함수.
 * @returns 각 통화의 범위 중 하나가 일치하는 조건 또는 조건이 없으면 빈 문자열.
 */
function budgetConditions(range: (id: string, expression: string) => string) {
  // 두 통화의 범위는 해당 통화 행에만 값이 있으므로 하나라도 충족하면 표시한다.
  const conditions = [
    range("budget", "json_extract(fields, '$.budget')"),
    range("budgetUsd", "json_extract(fields, '$.budgetUsd')"),
  ].filter(Boolean);
  // 두 통화를 결합할 때 각 OR 분기에도 공개 조건을 넣어 통화별 부분 인덱스를 탐색한다.
  if (conditions.length === 2) {
    return `((visible = 1 AND ${conditions[0]}) OR (visible = 1 AND ${conditions[1]}))`;
  }
  // 단일 통화는 목록 최상위 조건의 공개 범위를 그대로 적용한다.
  return conditions[0] ?? "";
}

/**
 * 사전규격 목록과 업무구분 선택지의 전용 조회를 구성한다.
 * @param db 사전규격 목록, 선택지 집계와 원본을 함께 읽는 DB 연결.
 * @returns 관리자와 사용자가 공유하는 목록 및 선택지 조회 함수.
 */
export function openPriorSpecList(db: G2bDatabase) {
  // 원본 전체를 읽지 않고 현재 사용 중인 선택지의 값과 라벨을 반환한다.
  const options = db.prepare(`SELECT json_extract(pair, '$[0]') AS value, json_extract(pair, '$[1]') AS label
    FROM g2b_prior_spec_list_businesses WHERE uses > 0 ORDER BY label, value`);

  return {
    /**
     * 저장 사전규격에 기록된 업무구분 선택지를 표시 순으로 읽는다.
     * 조회 행에서 값과 라벨만 복사해 React에 전달할 선택지를 구성한다.
     * @returns 조회 순서대로 값과 라벨을 담은 일반 객체 목록.
     * @throws Turso에서 선택지 조회가 실패한 경우.
     */
    async businesses() {
      // 집계에 남아 있는 업무구분을 정렬된 순서로 읽는다.
      const rows = await options.all() as { value: string; label: string }[];
      // libSQL이 열 접근에 사용하는 숨은 속성을 제외하고 화면용 선택지를 반환한다.
      return rows.map(
        /**
         * 조회 행의 업무 코드와 라벨을 일반 객체에 담는다.
         * @param row 업무구분의 값과 라벨이 들어 있는 조회 행.
         * @returns 화면에 전달할 값과 라벨만 담은 선택지.
         */
        ({ value, label }) => ({ value, label }),
      );
    },

    /**
     * 검색과 필터를 적용해 상태별 건수를 계산하고 보정한 페이지의 상세값을 같은 스냅샷에서 읽는다.
     * @param query 화면의 검증된 검색, 필터, 정렬, 상태 및 페이지.
     * @returns 상태별 건수와 페이지 정보 및 표시할 사전규격 행.
     * @throws Turso에서 목록 조회가 실패한 경우.
     */
    async page(query: CollectionListQuery) {
      // 공통 목록과 동일한 사전규격번호·접수번호 검색, 업무구분 및 날짜 비교 조건을 적용한다.
      const { where, values, order, ascending } = collectionListCriteria(query, budgetConditions);
      // 기본 날짜순 예산 단독 요청만 범위에 따라 페이지 조회 경로를 고른다.
      const adaptiveBudget = order === "sortDate" && !ascending && where.length === 1 && where[0].includes("json_extract(fields, '$.budget");
      // 결합 필터와 다른 정렬은 예산 인덱스 도입 전의 후보 탐색을 유지한다.
      const filters = adaptiveBudget ? where : where.map((clause) => clause.replaceAll("json_extract(fields, '$.budget", "+json_extract(fields, '$.budget"));
      const criteria = ["visible = 1", ...filters].join(" AND ");
      const direction = ascending ? "ASC NULLS LAST" : "DESC";
      // 기본 날짜 오름차순은 빈 날짜가 마지막에 오도록 인덱스와 같은 순서로 후보를 읽는다.
      const pageOrder = order === "sortDate" && ascending
        ? "(sortDate IS NULL) ASC, sortDate ASC"
        // 미수집은 전체 제목 인덱스를 훑지 않도록 기존 상태별 탐색을 유지한다.
        : order === "sortTitle" && query.status === "uncollected"
          ? `+${order} ${direction}`
          : order === "sortTitle" && ascending
            ? "(sortTitle IS NULL) ASC, sortTitle ASC"
            : `${order} ${direction}`;
      const status = query.status === "collected" ? "collected_at IS NOT NULL"
        : query.status === "uncollected" ? "collected_at IS NULL" : "TRUE";
      // 지원되는 검색만 후보를 좁히고 기존 필터를 통과한 행을 같은 스냅샷에서 조회한다.
      /**
       * 선택된 검색 조각으로 이 업무의 건수와 요청 페이지를 조회한다.
       * @param grams 검색 출처별 조각. 비어 있으면 기존 목록을 읽는다.
       * @returns 상태별 건수와 페이지 데이터.
       */
      return withListSearch(db, "prior-specs", query.search, (grams) => withBusinessKeys(
        db, "prior-specs", query.filters.business, Boolean(grams.length || query.filters.date), async (candidateKeys) => {
        // 후보 제한이 가능하면 동일한 일치 집합을 집계와 페이지에 전달한다.
        const source = numberSearchSource("prior-specs", grams, criteria, values, candidateKeys);
        // 기본 조회는 사전 집계 한 행을 사용하고 검색·필터 조회는 조건에 맞는 키를 센다.
        const totals = where.length
          ? `SELECT COUNT(*) AS total, COUNT(collected_at) AS collected FROM ${source.filtered}`
          : "SELECT total, collected FROM g2b_collection_list_counts WHERE section = 'prior-specs' AND scope = 'all'";
        const selected = query.status === "collected" ? "collected" : query.status === "uncollected" ? "total - collected" : "total";
        // 정렬과 페이지 경계를 먼저 확정해 원본 사전규격과 최신 시도는 선택한 키에 한해서 조회한다.
        // 날짜 범위와 번호·업무구분을 함께 검사할 때는 NULL이 범위에 포함되지 않는다.
        const compoundDateOrder = order === "sortDate" && ascending && !source.prefix
          && query.search.field === "number" && Boolean(query.search.query)
          && (Array.isArray(query.filters.business) && query.filters.business.length > 0) && where.some(clause => clause.startsWith("sortDate "));
        // 조건 없는 미수집 날짜순은 전체 목록 대신 상태별 인덱스에서 페이지 키를 읽는다.
        const pageSource = order === "sortDate" && ascending && query.status === "uncollected" && !where.length && !source.prefix
          ? `g2b_prior_spec_list INDEXED BY g2b_prior_spec_list_uncollected_asc WHERE ` + criteria + " AND TRUE AND"
          : compoundDateOrder
            ? `g2b_prior_spec_list INDEXED BY g2b_prior_spec_list_date_asc WHERE (sortDate IS NULL) = 0 AND ` + criteria + " AND"
            : source.page;
        const defaultPage = `paged AS MATERIALIZED (
            SELECT number, revision, opening_revision, collected_at, latest_id, ${order} AS sortValue
            FROM ${pageSource} ${status}
            ORDER BY ${compoundDateOrder ? order + " ASC" : pageOrder}, number, revision, opening_revision
            LIMIT ${pageSize} OFFSET (
              SELECT (max(1, min(?, ((${selected}) + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} FROM totals
            )
          )`;
        // 좁은 예산은 예산 인덱스로 탐색하고 넓은 예산은 기존 날짜 인덱스 순서대로 읽는다.
        const dateIndex = query.status === "collected" ? "collected"
          : query.status === "uncollected" ? "uncollected" : "date";
        // 넓은 범위에서도 수집 상태별 부분 인덱스로 관련 행만 읽는다.
        const budgetPage = adaptiveBudget ? budgetPageSql(
          "prior-specs", "g2b_prior_spec_list",
          `g2b_prior_spec_list INDEXED BY g2b_prior_spec_list_${dateIndex}`, "sortDate", criteria, status, selected,
        ) : "";
        // 검색과 필터가 없는 날짜 오름차순 전체 목록의 깊은 페이지는 구간 경계에서 탐색한다.
        const seekDatePage = order === "sortDate" && ascending && query.page >= firstDateSeekPage
          && query.status === "total" && !where.length;
        // 예산 분기와 기본 조회를 포함한 모든 경로는 같은 응답을 조립한다.
        const pageSql = seekDatePage ? dateBucketPageSql("prior-specs") : adaptiveBudget ? budgetPage : defaultPage;
        // 날짜 범위만 적용한 관리자 전체 목록은 구간 집계와 기존 날짜 인덱스를 사용한다.
        const rangePage = order === "sortDate" && ascending && query.status === "total" && !source.prefix
          ? rangedDatePage("prior-specs", where, values, query.page)
          : undefined;
        // 기존 조회와 날짜 구간 조회는 최종 행 조립을 공유한다.
        const pageCtes = rangePage?.sql ?? `${source.prefix}totals AS MATERIALIZED (${totals}), ${pageSql}`;
        const sql = `WITH ${pageCtes}
          SELECT paged.number, paged.revision, paged.opening_revision AS openingRevision,
            paged.collected_at AS collectedAt, json_extract(saved.data, '$.payload.dlBfSpecM.bfSpecNm') AS title,
            CAST(json_extract(saved.data, '$.payload.dlBfSpecM.prcmBsneSeCd') AS TEXT) AS businessCode,
            json_extract(saved.data, '$.payload.dlBfSpecM.prcmBsneSeCdNm') AS businessLabel,
            attempt.id, attempt.started_at AS startedAt, attempt.status, attempt.error, paged.sortValue,
            totals.total, totals.collected, ${selected} AS selectedCount, attempt.diagnostics
          FROM totals LEFT JOIN paged ON TRUE
          LEFT JOIN prior_specs saved ON paged.collected_at IS NOT NULL AND saved.number = paged.number
          LEFT JOIN g2b_collection_attempts attempt ON attempt.id = paged.latest_id
          ORDER BY paged.sortValue ${direction}, paged.number, paged.revision, paged.opening_revision`;
        // 조건 인자를 집계와 페이지에 각각 전달한 뒤 빈 목록에서도 반환되는 집계 행을 사용한다.
        const args = source.args ? [...source.args, query.page] : adaptiveBudget ? [...values, query.page, "all", ...values, ...values] : [...values, ...values, query.page];
        const rows = await db.prepare(sql).all(...(rangePage?.args ?? args)) as
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
      }));
    },
  };
}
