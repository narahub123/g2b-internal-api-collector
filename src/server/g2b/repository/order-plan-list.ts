import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { CollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { cleanText, queryCollectionPage, sortDate } from "./collection-list-query";

function orderPlanFields(data: unknown) {
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
 * @throws SQLite 함수 등록이나 조회문 준비가 실패한 경우.
 */
export function openOrderPlanList(db: DatabaseSync, targets: string) {
  db.function("order_plan_list_fields", { deterministic: true }, orderPlanFields);
  const businesses = db.prepare(`
    SELECT DISTINCT json_extract(data, '$.payload.dlOderPlanM.prcmBsneSeCd') AS code,
      json_extract(data, '$.payload.dlOderPlanM.prcmBsneSeCdNm') AS label
    FROM order_plans
  `);

  return {
    /**
     * 저장 자료의 업무구분을 목록 배지와 같은 이름으로 반환한다.
     * @throws SQLite에서 업무구분을 조회하지 못한 경우.
     */
    businesses() {
      const options = new Map<string, string>();
      for (const row of businesses.all()) {
        const business = resolveG2bBusiness(row.code, row.label);
        if (business) options.set(business.code ?? business.label, business.label);
      }
      return [...options].map(([value, label]) => ({ value, label }))
        .sort((first, second) => first.label.localeCompare(second.label, "ko"));
    },

    /**
     * 발주계획의 검색·필터를 적용한 건수와 선택 상태의 페이지를 반환한다.
     * @throws SQLite에서 검색 또는 집계에 실패한 경우.
     */
    page(query: CollectionListQuery) {
      const where: string[] = [];
      const values: SQLInputValue[] = [];
      if (query.search.query) {
        const column = query.search.field === "number" ? "number"
          : query.search.field === "agency" ? "agency" : "sortTitle";
        where.push(`instr(collection_search_text(${column}), collection_search_text(?)) > 0`);
        values.push(query.search.query);
      }
      for (const id of ["released", "budget"]) {
        const range = query.filters[id];
        if (!range || !("from" in range || "to" in range)) continue;
        const column = id === "released" ? "substr(released, 1, 10)" : "budget";
        if (range.from !== undefined) {
          where.push(`${column} >= ?`);
          values.push(range.from);
        }
        if (range.to !== undefined) {
          where.push(`${column} <= ?`);
          values.push(range.to);
        }
      }
      const selected = query.filters.business;
      if (Array.isArray(selected) && selected.length) {
        where.push("json_extract(fields, '$.business') IN (SELECT value FROM json_each(?))");
        values.push(JSON.stringify(selected));
      }
      const [field, direction] = query.sort.split("-");
      return queryCollectionPage(db, targets, {
        section: "order-plans",
        projection: "order_plan_list_fields(saved.data) AS fields, NULLIF(collection_search_text(saved.title), '') AS sortTitle",
        columns: `json_extract(fields, '$.released') AS released, json_extract(fields, '$.agency') AS agency,
          json_extract(fields, '$.budget') AS budget`,
        where,
        values,
        order: field === "title" ? "sortTitle" : "released",
        ascending: direction === "asc",
        status: query.status,
        page: query.page,
      });
    },
  };
}
