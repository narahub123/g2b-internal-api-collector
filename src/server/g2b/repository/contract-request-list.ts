import type { CollectionListRow } from "./collection-attempts";
import { COLLECTION_LIST_PAGE_SIZE as pageSize } from "@/shared/config/collection-list";
import type { G2bDatabase, SQLInputValue } from "./database";
import { getContractRequestDisplay } from "@/entities/contract-request/model/contract-request-display";
import type { CollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import { cleanText, searchText, sortDate } from "./collection-list-query";

/** 수집 원본에서 목록 검색과 정렬에 필요한 파생값을 계산한다. */
export function contractRequestFields(raw: unknown, includeItems: unknown) {
  const data = typeof raw === "string" ? JSON.parse(raw) : null;
  const detail = data?.detail ?? {};
  const items = Array.isArray(data?.items) ? data.items.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
  let names: string[] = [];
  if (includeItems && items.length) {
    // 요청물품정보에서 세부품명 열이 실제로 표시되는 업무만 검색에 포함한다.
    const { showItemList, columns } = getContractRequestDisplay(detail, items);
    if (showItemList && columns.some(([key]) => key === "dtlsPrnm")) {
      names = items.map((item) => cleanText(item.dtlsPrnm)).filter(Boolean);
    }
  }
  return JSON.stringify({
    written: sortDate(detail.inptDt),
    business: cleanText(detail.prcmBsneAreaNm),
    agency: cleanText(detail.dmstUntyGrpNm),
    receipt: cleanText(detail.bizNo),
    names,
  });
}

/**
 * 계약요청 저장 자료와 최신 수집 시도에서 업무구분 옵션과 목록 페이지를 조회한다.
 * @param db 계약요청의 전용 목록과 공통 집계를 읽는 DB 연결.
 * @returns 계약요청 선택지와 페이지 조회 함수.
 */
export function openContractRequestList(db: G2bDatabase) {
  // 기존 표시 정규화에 사용할 원본 업무구분 값만 집계 테이블에서 읽는다.
  const businesses = db.prepare(`SELECT label FROM g2b_contract_request_list_businesses WHERE uses > 0`);

  return {
    /**
     * 저장된 계약요청의 업무구분 표시값을 다중 선택 옵션으로 반환한다.
     * @returns 표시값과 선택값이 같은 업무구분 옵션 목록.
     * @throws Turso에서 업무구분을 조회하지 못한 경우.
     */
    async businesses() {
      // 정규화 후 중복을 제거해 원본 표기가 다른 같은 업무를 한 선택지로 반환한다.
      const labels = new Set((await businesses.all()).map(({ label }) => cleanText(label)).filter(Boolean));
      return [...labels].sort((a, b) => a.localeCompare(b, "ko")).map((label) => ({ value: label, label }));
    },

    /**
     * 검색·필터를 적용한 상태별 건수와 선택 상태의 계약요청 페이지를 반환한다.
     * @param query URL에서 검증한 검색·필터·정렬과 상태 및 페이지.
     * @returns 상태별 건수, 보정한 페이지와 표시용 계약요청 행.
     * @throws Turso에서 검색 또는 집계에 실패한 경우.
     */
    async page(query: CollectionListQuery) {
      // 활성 조건과 사용자 입력을 각각 모아 집계와 페이지 선택에 함께 사용한다.
      const where: string[] = [];
      const values: SQLInputValue[] = [];
      const { field, query: keyword } = query.search;
      if (keyword) {
        // 표시용 파생 품명에서 존재 여부만 확인해 여러 품목이 일치해도 요청을 한 번만 센다.
        if (field === "item") {
          where.push("EXISTS (SELECT 1 FROM json_each(fields, '$.names') WHERE instr(value, ?) > 0)");
          values.push(searchText(keyword));
        } else if (field === "number") {
          const normalized = keyword.replace(/[\s/-]+/g, "");
          where.push("(instr(lower(number || revision), ?) > 0 OR instr(receipt, ?) > 0)");
          values.push(searchText(normalized || keyword), searchText(keyword));
        } else {
          const column = field === "agency" ? "agency" : "sortTitle";
          where.push(`instr(${column}, ?) > 0`);
          values.push(searchText(keyword));
        }
      }
      // 작성 시각을 제외한 날짜 범위와 검색용 업무구분 파생값으로 필터링한다.
      const range = query.filters.written;
      if (range && ("from" in range || "to" in range)) {
        if (range.from !== undefined) {
          where.push("substr(written, 1, 10) >= ?");
          values.push(range.from);
        }
        if (range.to !== undefined) {
          where.push("substr(written, 1, 10) <= ?");
          values.push(range.to);
        }
      }
      const selected = query.filters.business;
      if (Array.isArray(selected) && selected.length) {
        where.push("json_extract(fields, '$.business') IN (SELECT value FROM json_each(?))");
        values.push(JSON.stringify(selected));
      }
      const [sort, direction] = query.sort.split("-");
      // 검증된 정렬 키만 목록 열에 매핑한다.
      const order = sort === "title" ? "sortTitle" : "written";
      const ascending = direction === "asc";
      const criteria = where.length ? where.join(" AND ") : "TRUE";
      const sortDirection = ascending ? "ASC NULLS LAST" : "DESC";
      const status = query.status === "collected" ? "collected_at IS NOT NULL"
        : query.status === "uncollected" ? "collected_at IS NULL" : "TRUE";
      // 기본 조회는 사전 집계 한 행을 사용하고 검색·필터 조회는 조건에 맞는 키를 센다.
      const totals = where.length
        ? `SELECT COUNT(*) AS total, COUNT(collected_at) AS collected FROM g2b_contract_request_list WHERE ${criteria}`
        : "SELECT total, collected FROM g2b_collection_list_counts WHERE section = 'contract-requests' AND scope = 'all'";
      const selectedCountSql = query.status === "collected" ? "collected" : query.status === "uncollected" ? "total - collected" : "total";
      // 정렬과 페이지 경계를 먼저 확정해 원본 계약요청과 최신 시도는 선택한 키에 한해서 조회한다.
      const sql = `WITH totals AS MATERIALIZED (${totals}),
        paged AS MATERIALIZED (
          SELECT number, revision, opening_revision, collected_at, latest_id, ${order} AS sortValue
          FROM g2b_contract_request_list WHERE ${criteria} AND ${status}
          ORDER BY ${order} ${sortDirection}, number, revision, opening_revision
          LIMIT ${pageSize} OFFSET (
            SELECT (max(1, min(?, ((${selectedCountSql}) + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} FROM totals
          )
        )
        SELECT paged.number, paged.revision, paged.opening_revision AS openingRevision,
          paged.collected_at AS collectedAt, json_extract(saved.data, '$.detail.bizNm') AS title,
          NULL AS businessCode,
          json_extract(saved.data, '$.detail.prcmBsneAreaNm') AS businessLabel,
          attempt.id, attempt.started_at AS startedAt, attempt.status, attempt.error, paged.sortValue,
          totals.total, totals.collected, ${selectedCountSql} AS selectedCount, attempt.diagnostics
        FROM totals LEFT JOIN paged ON TRUE
        LEFT JOIN contract_requests saved ON paged.collected_at IS NOT NULL AND saved.number = paged.number AND saved.revision = paged.revision
        LEFT JOIN g2b_collection_attempts attempt ON attempt.id = paged.latest_id
        ORDER BY paged.sortValue ${sortDirection}, paged.number, paged.revision, paged.opening_revision`;
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
