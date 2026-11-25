import { withBusinessKeys } from "./business-filter";
import { dateBucketPageSql, firstDateSeekPage } from "./date-bucket-page";
import { numberSearchSource, withListSearch } from "./number-search";
import type { CollectionListRow } from "./collection-attempts";
import type { CollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import { COLLECTION_LIST_PAGE_SIZE as pageSize } from "@/shared/config/collection-list";
import { openingResultTitleSql, openingResultBusinessCodeSql, openingResultBusinessLabelSql } from "./opening-result-list-sql";
import type { G2bDatabase } from "./database";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { cleanText, collectionListCriteria, sortDate } from "./collection-list-query";

/** 수집 원본에서 목록 검색과 정렬에 필요한 파생값을 계산한다. */
export function openingResultFields(raw: unknown) {
  const data = typeof raw === "string" ? JSON.parse(raw) : null;
  const businesses: NonNullable<ReturnType<typeof resolveG2bBusiness>>[] = [];
  const results = Array.isArray(data?.results) ? data.results : [];
  // 한 개찰차수에 분류별 결과가 여럿이면 가장 늦은 실제개찰일시를 사용한다.
  // 유찰 등 실제개찰일시가 없는 응답에 예정일시는 대입하지 않는다.
  let date: string | null = null;
  const agencies = new Set<string>();
  for (const result of results) {
    const actual = sortDate(result?.detail?.bidInfo?.realOnbsDt);
    if (actual && (date === null || actual > date)) date = actual;
    const agency = cleanText(result?.detail?.bidInfo?.dmstNm);
    if (agency) agencies.add(agency);
    const business = resolveG2bBusiness(result?.query?.businessCode, undefined);
    if (business) businesses.push(business);
  }
  return JSON.stringify({ date, agencies: [...agencies], businesses });
}

/**
 * 개찰결과 목록과 업무구분 선택지의 전용 조회를 구성한다.
 * @param db 개찰결과 목록, 선택지 집계와 원본을 함께 읽는 DB 연결.
 * @returns 관리자와 사용자가 공유하는 목록 및 선택지 조회 함수.
 */
export function openOpeningResultList(db: G2bDatabase) {
  // 원본 전체를 읽지 않고 현재 사용 중인 선택지의 값과 라벨을 반환한다.
  const options = db.prepare(`SELECT json_extract(pair, '$[0]') AS value, json_extract(pair, '$[1]') AS label
    FROM g2b_opening_result_list_businesses WHERE uses > 0 ORDER BY label, value`);

  return {
    /**
     * 저장 개찰결과에 기록된 업무구분 선택지를 표시 순으로 읽는다.
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
     * @returns 상태별 건수와 페이지 정보 및 표시할 개찰결과 행.
     * @throws Turso에서 목록 조회가 실패한 경우.
     */
    async page(query: CollectionListQuery) {
      // 공통 목록과 동일한 입찰공고번호 검색, 업무구분 및 실제개찰일시 비교 조건을 적용한다.
      const { where, values, order, ascending } = collectionListCriteria(query);
      const criteria = where.length ? where.join(" AND ") : "TRUE";
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
      return withListSearch(db, "opening-results", query.search, (grams) => withBusinessKeys(
        db, "opening-results", query.filters.business, Boolean(grams.length || query.filters.date), async (candidateKeys) => {
        // 후보 제한이 가능하면 동일한 일치 집합을 집계와 페이지에 전달한다.
        const source = numberSearchSource("opening-results", grams, criteria, values, candidateKeys);
        // 기본 조회는 사전 집계 한 행을 사용하고 검색·필터 조회는 조건에 맞는 키를 센다.
        const totals = where.length
          ? `SELECT COUNT(*) AS total, COUNT(collected_at) AS collected FROM ${source.filtered}`
          : "SELECT total, collected FROM g2b_collection_list_counts WHERE section = 'opening-results' AND scope = 'all'";
        const selected = query.status === "collected" ? "collected" : query.status === "uncollected" ? "total - collected" : "total";
        // 정렬과 페이지 경계를 먼저 확정해 원본 개찰결과, 연결 공고와 최신 시도는 선택한 키에 한해서 조회한다.
        // 검색과 필터가 없는 날짜 오름차순 전체 목록의 깊은 페이지는 구간 경계에서 탐색한다.
        const seekDatePage = order === "sortDate" && ascending && query.page >= firstDateSeekPage
          && query.status === "total" && !where.length;
        // 다른 조건에서는 기존 정렬과 페이지 보정을 사용해 목록 키를 정한다.
        // 조건 없는 미수집 날짜순은 전체 목록 대신 상태별 인덱스에서 페이지 키를 읽는다.
        const pageSource = order === "sortDate" && ascending && query.status === "uncollected" && !where.length && !source.prefix
          ? `g2b_opening_result_list INDEXED BY g2b_opening_result_list_uncollected_asc WHERE ` + criteria + " AND TRUE AND"
          : source.page;
        const defaultPage = `
          paged AS MATERIALIZED (
            SELECT number, revision, opening_revision, collected_at, latest_id, ${order} AS sortValue
            FROM ${pageSource} ${status}
            ORDER BY ${pageOrder}, number, revision, opening_revision
            LIMIT ${pageSize} OFFSET (
              SELECT (max(1, min(?, ((${selected}) + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} FROM totals
            )
          )`;
        // 페이지 키 경로만 바꾸고 상세 조립과 출력 정렬은 그대로 사용한다.
        const pageSql = seekDatePage ? dateBucketPageSql("opening-results") : defaultPage;
        const sql = `WITH ${source.prefix}totals AS MATERIALIZED (${totals}), ${pageSql}
          SELECT paged.number, paged.revision, paged.opening_revision AS openingRevision,
            paged.collected_at AS collectedAt, ${openingResultTitleSql} AS title,
            CAST(${openingResultBusinessCodeSql} AS TEXT) AS businessCode,
            ${openingResultBusinessLabelSql} AS businessLabel,
            attempt.id, attempt.started_at AS startedAt, attempt.status, attempt.error, paged.sortValue,
            totals.total, totals.collected, ${selected} AS selectedCount, attempt.diagnostics
          FROM totals LEFT JOIN paged ON TRUE
          LEFT JOIN opening_results result ON paged.collected_at IS NOT NULL AND result.number = paged.number
            AND result.revision = paged.revision AND result.opening_revision = paged.opening_revision
          LEFT JOIN notices notice ON notice.number = result.number AND notice.revision = result.revision AND json_valid(notice.data)
          LEFT JOIN g2b_collection_attempts attempt ON attempt.id = paged.latest_id
          ORDER BY paged.sortValue ${direction}, paged.number, paged.revision, paged.opening_revision`;
        // 조건 인자를 집계와 페이지에 각각 전달한 뒤 빈 목록에서도 반환되는 집계 행을 사용한다.
        const rows = await db.prepare(sql).all(...(source.args ?? [...values, ...values]), query.page) as
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
