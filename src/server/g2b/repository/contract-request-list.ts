import type { G2bDatabase, SQLInputValue } from "./database";
import { getContractRequestDisplay } from "@/entities/contract-request/model/contract-request-display";
import type { CollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import { cleanText, searchText, queryCollectionPage, sortDate } from "./collection-list-query";

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
 * @throws SQLite 함수 등록이나 조회문 준비가 실패한 경우.
 */
export function openContractRequestList(db: G2bDatabase, targets: string) {
  const businesses = db.prepare(`
    SELECT DISTINCT json_extract(data, '$.detail.prcmBsneAreaNm') AS label
    FROM contract_requests
  `);

  return {
    /**
     * 저장된 계약요청의 업무구분 표시값을 다중 선택 옵션으로 반환한다.
     * @throws Turso에서 업무구분을 조회하지 못한 경우.
     */
    async businesses() {
      const labels = new Set((await businesses.all()).map(({ label }) => cleanText(label)).filter(Boolean));
      return [...labels].sort((a, b) => a.localeCompare(b, "ko")).map((label) => ({ value: label, label }));
    },

    /**
     * 검색·필터를 적용한 상태별 건수와 선택 상태의 계약요청 페이지를 반환한다.
     * @throws Turso에서 검색 또는 집계에 실패한 경우.
     */
    page(query: CollectionListQuery) {
      const where: string[] = [];
      const values: SQLInputValue[] = [];
      const { field, query: keyword } = query.search;
      if (keyword) {
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
      return queryCollectionPage(db, targets, {
        section: "contract-requests",
        projection: `json_extract(saved.query_data, '$.fields') AS fields,
          NULLIF(saved.searchTitle, '') AS sortTitle`,
        columns: `json_extract(fields, '$.written') AS written, json_extract(fields, '$.agency') AS agency,
          json_extract(fields, '$.receipt') AS receipt`,
        where,
        values,
        order: sort === "title" ? "sortTitle" : "written",
        ascending: direction === "asc",
        status: query.status,
        page: query.page,
      });
    },
  };
}
