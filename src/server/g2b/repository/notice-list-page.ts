import { COLLECTION_LIST_PAGE_SIZE as pageSize } from "@/shared/config/collection-list";
import type { NoticeListQuery } from "@/entities/notice/model/notice-list-query";
import type { CollectionListRow } from "./collection-attempts";
import type { G2bDatabase, SQLInputValue } from "./database";

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
  const { where, values, order, ascending, excludeMockNotices } = options;
  const sortValue = order === "posted" ? "posted" : `json_extract(fields, '$.${order}')`;
  const direction = ascending ? "ASC NULLS LAST" : "DESC";
  // 공고번호와 차수가 같으면 개찰차수로 페이지 경계의 순서를 고정한다.
  const tieBreak = "number, revision, opening_revision";
  // 검색 범위는 집계와 페이지에 적용하고 수집 상태는 페이지에만 적용한다.
  const criteria = [...(excludeMockNotices ? ["is_mock = 0"] : []), ...where];
  const condition = criteria.length ? criteria.join(" AND ") : "TRUE";
  const status = query.status === "collected" ? "collected_at IS NOT NULL"
    : query.status === "uncollected" ? "collected_at IS NULL" : "TRUE";
  // 기본 목록은 업무와 노출 범위로 공통 집계 한 행을 읽고, 검색·필터는 일치하는 목록 행을 센다.
  const scope = excludeMockNotices ? "exclude_mock" : "all";
  const totals = where.length
    ? `SELECT COUNT(*) AS total, COUNT(collected_at) AS collected FROM g2b_notice_list WHERE ${condition}`
    : "SELECT total, collected FROM g2b_collection_list_counts WHERE section = 'notices' AND scope = ?";
  // 선택 상태의 건수로 요청 페이지가 범위를 벗어났는지 계산한다.
  const selected = query.status === "collected" ? "collected" : query.status === "uncollected" ? "total - collected" : "total";
  // 페이지 키를 먼저 확정한 뒤 기본 키로 공고와 최신 수집 시도의 상세 정보를 가져온다.
  const sql = `WITH totals AS MATERIALIZED (${totals}),
    paged AS MATERIALIZED (
      SELECT number, revision, opening_revision, collected_at, latest_id, ${sortValue} AS sortValue
      FROM g2b_notice_list WHERE ${condition} AND ${status}
      ORDER BY ${sortValue} ${direction}, ${tieBreak}
      LIMIT ${pageSize} OFFSET (
        SELECT (max(1, min(?, ((${selected}) + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} FROM totals
      )
    )
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
  const rows = await db.prepare(sql).all(...(where.length ? values : [scope]), ...values, query.page) as
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
