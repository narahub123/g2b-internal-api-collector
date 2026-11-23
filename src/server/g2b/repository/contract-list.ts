import type { G2bDatabase } from "./database";
import type { CollectionListRow } from "./collection-attempts";
import type { CollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import { COLLECTION_LIST_PAGE_SIZE as pageSize } from "@/shared/config/collection-list";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { cleanText, collectionListCriteria, sortDate } from "./collection-list-query";

/** 수집 원본에서 목록 검색과 정렬에 필요한 파생값을 계산한다. */
export function contractFields(raw: unknown, rawCode: unknown, rawLabel: unknown) {
  const data = typeof raw === "string" ? JSON.parse(raw) : null;
  const business = resolveG2bBusiness(rawCode, rawLabel);
  const businesses = business ? [business] : [];
  const detail = data?.detail;
  return JSON.stringify({
    date: sortDate(detail?.frstCtrtDt),
    agencies: [cleanText(detail?.dmstUntyGrpNm)].filter(Boolean),
    receipt: cleanText(detail?.ctrtView),
    businesses,
  });
}

/**
 * 계약현황 목록과 업무구분 선택지의 전용 조회를 구성한다.
 * @param db 계약 목록, 선택지 집계와 원본을 함께 읽는 DB 연결.
 * @returns 관리자와 사용자가 공유하는 목록 및 선택지 조회 함수.
 */
export function openContractList(db: G2bDatabase) {
  // 원본 전체를 읽지 않고 현재 사용 중인 선택지의 값과 라벨을 반환한다.
  const options = db.prepare(`SELECT json_extract(pair, '$[0]') AS value, json_extract(pair, '$[1]') AS label
    FROM g2b_contract_list_businesses WHERE uses > 0 ORDER BY label, value`);

  return {
    /**
     * 저장 계약에 기록된 업무구분 선택지를 표시 순으로 읽는다.
     * @returns 값과 라벨을 담은 선택지 목록.
     * @throws Turso에서 선택지 조회가 실패한 경우.
     */
    async businesses() {
      return await options.all() as { value: string; label: string }[];
    },

    /**
     * 검색과 필터를 적용해 상태별 건수를 계산하고 보정한 페이지의 상세값을 같은 스냅샷에서 읽는다.
     * @param query 화면의 검증된 검색, 필터, 정렬, 상태 및 페이지.
     * @returns 상태별 건수와 페이지 정보 및 표시할 계약 행.
     * @throws Turso에서 목록 조회가 실패한 경우.
     */
    async page(query: CollectionListQuery) {
      // 공통 목록과 동일한 계약번호·접수번호 검색, 업무구분 및 날짜 비교 조건을 적용한다.
      const { where, values, order, ascending } = collectionListCriteria(query);
      const criteria = where.length ? where.join(" AND ") : "TRUE";
      const direction = ascending ? "ASC NULLS LAST" : "DESC";
      const status = query.status === "collected" ? "collected_at IS NOT NULL"
        : query.status === "uncollected" ? "collected_at IS NULL" : "TRUE";
      // 기본 조회는 사전 집계 한 행을 사용하고 검색·필터 조회는 조건에 맞는 키를 센다.
      const totals = where.length
        ? `SELECT COUNT(*) AS total, COUNT(collected_at) AS collected FROM g2b_contract_list WHERE ${criteria}`
        : "SELECT total, collected FROM g2b_collection_list_counts WHERE section = 'contracts' AND scope = 'all'";
      const selected = query.status === "collected" ? "collected" : query.status === "uncollected" ? "total - collected" : "total";
      // 정렬과 페이지 경계를 먼저 확정해 원본 계약과 최신 시도는 선택한 키에 한해서 조회한다.
      const sql = `WITH totals AS MATERIALIZED (${totals}),
        paged AS MATERIALIZED (
          SELECT number, revision, opening_revision, collected_at, latest_id, ${order} AS sortValue
          FROM g2b_contract_list WHERE ${criteria} AND ${status}
          ORDER BY ${order} ${direction}, number, revision, opening_revision
          LIMIT ${pageSize} OFFSET (
            SELECT (max(1, min(?, ((${selected}) + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} FROM totals
          )
        )
        SELECT paged.number, paged.revision, paged.opening_revision AS openingRevision,
          paged.collected_at AS collectedAt, json_extract(saved.data, '$.detail.ctrtNm') AS title,
          CAST(json_extract(saved.data, '$.detail.prcmBsneSeCd') AS TEXT) AS businessCode,
          json_extract(saved.data, '$.detail.prcmBsneSeNm') AS businessLabel,
          attempt.id, attempt.started_at AS startedAt, attempt.status, attempt.error, paged.sortValue,
          totals.total, totals.collected, ${selected} AS selectedCount, attempt.diagnostics
        FROM totals LEFT JOIN paged ON TRUE
        LEFT JOIN contracts saved ON paged.collected_at IS NOT NULL AND saved.number = paged.number AND saved.revision = paged.revision
        LEFT JOIN g2b_collection_attempts attempt ON attempt.id = paged.latest_id
        ORDER BY paged.sortValue ${direction}, paged.number, paged.revision, paged.opening_revision`;
      // 조건 인자를 집계와 페이지에 각각 전달한 뒤 빈 목록에서도 반환되는 집계 행을 사용한다.
      const rows = await db.prepare(sql).all(...values, ...values, query.page) as
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
    },
  };
}
