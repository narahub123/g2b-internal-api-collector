import { COLLECTION_LIST_PAGE_SIZE as pageSize } from "@/shared/config/collection-list";

/**
 * 예산 일치 건수로 페이지 조회 경로를 선택하고 선택한 경로에서만 목록 키를 읽는다.
 * @param section 사전 집계를 찾는 업무 식별자.
 * @param budgetSource 좁은 범위의 후보를 탐색할 저장소 내부 SQL 소스.
 * @param dateSource 넓은 범위의 후보를 기존 날짜순으로 읽을 SQL 소스.
 * @param dateColumn 해당 업무의 기본 날짜 정렬 열.
 * @param condition 집계와 페이지에 공통으로 적용하는 목록 조건.
 * @param status 선택한 수집 상태를 적용하는 페이지 조건.
 * @param selected 상태별 집계에서 페이지 보정에 사용할 건수 표현식.
 * @returns 요청 페이지, 노출 범위, 두 페이지 조건 순으로 인자를 받는 CTE SQL.
 */
export function budgetPageSql(
  section: "notices" | "order-plans" | "prior-specs",
  budgetSource: string,
  dateSource: string,
  dateColumn: string,
  condition: string,
  status: string,
  selected: string,
) {
  // 원본을 붙이기 전에 필요한 목록 키와 페이지 경계의 정렬 순서를 확정한다.
  const columns = `number, revision, opening_revision, collected_at, latest_id, ${dateColumn} AS sortValue`;
  const order = `${dateColumn} DESC, number, revision, opening_revision`;
  // 정확한 예산 집계와 기존 노출 범위 건수를 비교하고 같은 집계로 페이지를 보정한다.
  // 선택하지 않은 경로는 LIMIT이 0이므로 목록을 읽기 전에 종료한다.
  return `routing AS MATERIALIZED (
      SELECT total * 5 <= population AS narrow,
        (max(1, min(?, ((${selected}) + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} AS pageOffset
      FROM totals CROSS JOIN (SELECT total AS population FROM g2b_collection_list_counts WHERE section = '${section}' AND scope = ?)
    ),
    budget_paged AS MATERIALIZED (
      SELECT ${columns} FROM ${budgetSource} WHERE ${condition} AND ${status}
      ORDER BY ${order}
      LIMIT (SELECT CASE WHEN narrow THEN ${pageSize} ELSE 0 END FROM routing) OFFSET (SELECT pageOffset FROM routing)
    ),
    date_paged AS MATERIALIZED (
      SELECT ${columns} FROM ${dateSource} WHERE ${condition} AND ${status}
      ORDER BY ${order}
      LIMIT (SELECT CASE WHEN narrow THEN 0 ELSE ${pageSize} END FROM routing) OFFSET (SELECT pageOffset FROM routing)
    ),
    paged AS MATERIALIZED (SELECT * FROM budget_paged UNION ALL SELECT * FROM date_paged)`;
}
