import { dateBucketPageSql, firstDateSeekPage } from "./date-bucket-page";
import { budgetPageSql } from "./budget-range-page";
import { COLLECTION_LIST_PAGE_SIZE as pageSize } from "@/shared/config/collection-list";
import type { NoticeListQuery } from "@/entities/notice/model/notice-list-query";
import type { CollectionListRow } from "./collection-attempts";
import type { G2bDatabase, SQLInputValue } from "./database";
import { numberSearchSource, type SearchGram } from "./number-search";

// 목록 화면에서 정한 검색·필터 조건과 정렬 방식을 전달한다.
type PageOptions = {
  // 목록 저장소에서 작성한 조건이며 사용자 입력은 별도로 바인딩한다.
  where: string[];
  // 검색 및 필터 조건의 자리표시자 순서에 맞춘 값이다.
  values: SQLInputValue[];
  // 허용된 정렬 필드 중 선택한 목록 열 또는 JSON 키다.
  order: string;
  // 빈값을 마지막에 두면서 적용할 정렬 방향이다.
  ascending: boolean;
  // 사용자 목록에서 모의공고를 제외할지 나타낸다.
  excludeMockNotices: boolean;
  // 후보를 좁힐 수 있을 때만 채워지는 검색 조각.
  grams: SearchGram[];
  // 지역 또는 업무구분 범위가 좁을 때만 제공하는 목록 복합 키 JSON.
  candidateKeys?: string;
};

/**
 * 한 DB 스냅샷에서 건수를 읽고 보정된 페이지를 정한 뒤 해당 공고의 상세값을 붙인다.
 * @param db 입찰공고 목록과 원본을 함께 읽는 DB 연결.
 * @param query 검증한 목록 요청으로 수집 상태와 페이지 번호를 사용한다.
 * @param options SQL 조건, 바인딩, 정렬 및 모의공고 노출 범위.
 * @returns 상태별 건수, 보정한 페이지 번호, 총 페이지 수 및 표시용 행.
 * @throws Turso에서 목록 SQL 준비 또는 실행에 실패한 경우.
 */
export async function queryNoticePage(db: G2bDatabase, query: NoticeListQuery, options: PageOptions) {
  // 기본 게시일순은 인덱스 열을 직접 사용하고 나머지 정렬은 저장된 파생값을 사용한다.
  const { where, values, order, ascending, excludeMockNotices, grams, candidateKeys } = options;
  // 기존 게시일순이 보장되는 예산 단독 요청에서만 일치 건수로 조회 경로를 고른다.
  const budgetExpression = "json_extract(fields, '$.budget')";
  const adaptiveBudget = order === "posted" && !ascending && where.length > 0
    && where.every((clause) => clause.startsWith(budgetExpression));
  const sortValue = order === "posted" ? "posted" : `json_extract(fields, '$.${order}')`;
  const direction = ascending ? "ASC NULLS LAST" : "DESC";
  // 게시일 오름차순에서는 빈 날짜를 마지막에 두는 순서까지 인덱스와 일치시킨다.
  // 미수집 제목순은 기존 상태 인덱스를 우선할 수 있도록 제목 인덱스 정렬을 제외한다.
  const pageOrder = order === "posted" && ascending
    ? "(posted IS NULL) ASC, posted ASC"
    : order === "sortTitle" && query.status === "uncollected"
      ? `+${sortValue} ${direction}`
      : order === "sortTitle" && ascending
        ? `(${sortValue} IS NULL) ASC, ${sortValue} ASC`
        : `${sortValue} ${direction}`;
  // 공고번호와 차수가 같으면 개찰차수로 페이지 경계의 순서를 고정한다.
  const tieBreak = "number, revision, opening_revision";
  // 검색 범위는 집계와 페이지에 적용하고 수집 상태는 페이지에만 적용한다.
  // 다른 조회의 예산 비교는 기존 결과를 유지하면서 새 인덱스의 탐색 대상에서 제외한다.
  const filters = adaptiveBudget ? where : where.map((clause) =>
    clause.startsWith(budgetExpression) ? "+" + clause : clause);
  const criteria = [...(excludeMockNotices ? ["is_mock = 0"] : []), ...filters];
  const condition = criteria.length ? criteria.join(" AND ") : "TRUE";
  const status = query.status === "collected" ? "collected_at IS NOT NULL"
    : query.status === "uncollected" ? "collected_at IS NULL" : "TRUE";
  // 기본 목록은 업무와 노출 범위로 공통 집계 한 행을 읽고, 검색·필터는 일치하는 목록 행을 센다.
  const scope = excludeMockNotices ? "exclude_mock" : "all";
  // 예산 정렬은 기존 정렬 경로를 유지해 범위 필터용 인덱스의 영향을 받지 않는다.
  const candidateOrder = order === "budget" ? "+" + pageOrder : pageOrder;
  // 지역 또는 검색 후보로 만든 일치 집합을 집계와 페이지가 공유한다.
  const source = numberSearchSource("notices", grams, condition, values, candidateKeys);
  // 예산 단독 집계에만 기존의 명시적 예산 인덱스를 사용한다.
  const totalsSource = adaptiveBudget ? `g2b_notice_list INDEXED BY g2b_notice_list_budget WHERE ${condition}` : source.filtered;
  const totals = where.length
    ? `SELECT COUNT(*) AS total, COUNT(collected_at) AS collected FROM ${totalsSource}`
    : "SELECT total, collected FROM g2b_collection_list_counts WHERE section = 'notices' AND scope = ?";
  // 선택 상태의 건수로 요청 페이지가 범위를 벗어났는지 계산한다.
  const selected = query.status === "collected" ? "collected" : query.status === "uncollected" ? "total - collected" : "total";
  // 상태와 모의공고 노출 조건에 맞는 기존 게시일 인덱스를 선택한다.
  const postedIndex = query.status === "uncollected" ? "uncollected"
    : query.status === "collected" ? (excludeMockNotices ? "public" : "collected") : "posted";
  // 예산 단독 요청은 공고의 노출 범위와 상태에 맞는 분기 SQL을 사용한다.
  const budgetPage = adaptiveBudget ? budgetPageSql(
    "notices", "g2b_notice_list INDEXED BY g2b_notice_list_budget",
    `g2b_notice_list INDEXED BY g2b_notice_list_${postedIndex}`, "posted", condition, status, selected,
  ) : "";
  // 조건 없는 미수집 목록은 기존 제목순 경로와 새 날짜 오름차순 경로에서 상태별 인덱스를 사용한다.
  const uncollectedIndex = order === "posted" && ascending ? "uncollected_asc"
    : order === "sortTitle" ? "uncollected" : undefined;
  // 검색·필터가 있으면 기존 후보나 범위 인덱스를 선택할 수 있도록 제한하지 않는다.
  const pageSource = uncollectedIndex && query.status === "uncollected" && !where.length && !source.prefix
    ? `g2b_notice_list INDEXED BY g2b_notice_list_${uncollectedIndex} WHERE ${condition} AND TRUE AND`
    : source.page;
  // 페이지 키를 먼저 확정한 뒤 기본 키로 공고와 최신 수집 시도의 상세 정보를 가져온다.
  const defaultPage = `paged AS MATERIALIZED (
      SELECT number, revision, opening_revision, collected_at, latest_id, ${sortValue} AS sortValue
      FROM ${pageSource} ${status}
      ORDER BY ${candidateOrder}, ${tieBreak}
      LIMIT ${pageSize} OFFSET (
        SELECT (max(1, min(?, ((${selected}) + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} FROM totals
      )
    )`;
  // 검색·필터·수집 상태·공개 범위가 구간 집계와 일치하는 깊은 페이지에서만 구간을 탐색한다.
  const seekDatePage = order === "posted" && ascending && query.page >= firstDateSeekPage
    && !excludeMockNotices && query.status === "total" && !where.length;
  // 예산 및 다른 조건의 페이지는 검증된 기존 SQL 경로를 유지한다.
  const pageSql = seekDatePage ? dateBucketPageSql("notices") : adaptiveBudget ? budgetPage : defaultPage;
  // 기존 최종 표시 순서와 조회 결과 형태를 모든 경로에서 공유한다.
  const sql = `WITH ${source.prefix}totals AS MATERIALIZED (${totals}), ${pageSql}
    SELECT paged.number, paged.revision, paged.opening_revision AS openingRevision,
      paged.collected_at AS collectedAt, json_extract(saved.data, '$.title') AS title,
      CAST(COALESCE(json_extract(saved.data, '$.payload.dlUntyBidPbancM.prcmBsneSeCd'),
        json_extract(saved.data, '$.payload.dmItemMap.prcmBsneSeCd')) AS TEXT) AS businessCode,
      json_extract(saved.data, '$.payload.dmItemMap.prcmBsneSeNm') AS businessLabel,
      attempt.id, attempt.started_at AS startedAt, attempt.status, attempt.error, attempt.diagnostics,
      paged.sortValue, totals.total, totals.collected, ${selected} AS selectedCount
    FROM totals LEFT JOIN paged ON TRUE
    LEFT JOIN notices saved ON paged.collected_at IS NOT NULL AND saved.number = paged.number AND saved.revision = paged.revision
    LEFT JOIN g2b_collection_attempts attempt ON attempt.id = paged.latest_id
    ORDER BY paged.sortValue ${direction}, paged.number, paged.revision, paged.opening_revision`;
  // 집계에는 검색·필터의 인자 또는 기본 노출 범위를 전달하고 페이지에는 검색·필터 인자를 전달한다.
  const args = source.args ? [...source.args, query.page]
    : adaptiveBudget ? [...values, query.page, scope, ...values, ...values]
    : [...(where.length ? values : [scope]), ...values, query.page];
  const rows = await db.prepare(sql).all(...args) as
    (CollectionListRow & { total: number; collected: number; selectedCount: number })[];
  // 빈 페이지에도 집계가 한 행 남으므로 첫 행에서 페이지 범위를 계산한다.
  const { total, collected, selectedCount } = rows[0];
  const totalPages = Math.ceil(selectedCount / pageSize);
  // 호출자가 쓰는 목록 형식을 유지하며 집계 전용 빈 행을 표시 목록에서 제외한다.
  return {
    counts: { total, collected, uncollected: total - collected },
    page: Math.max(1, Math.min(query.page, totalPages)),
    totalPages,
    rows: rows.filter((row) => row.number !== null),
  };
}
