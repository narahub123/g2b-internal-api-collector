import { validateFilters } from "@/shared/ui/list-controls/model";
import type { ListFilter, ListOption } from "@/shared/ui/list-controls/model";
import type { CollectionListQuery, CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";

// 목록 제목에 표시되는 사업명과 발주계획 기본정보를 검색 대상으로 제공한다.
export const orderPlanSearchFields = [
  { value: "title", label: "사업명" },
  { value: "number", label: "발주계획번호" },
  { value: "agency", label: "발주기관" },
];

const defaultSort = "released-desc";
export const orderPlanSortOptions = [
  { value: defaultSort, label: "공개일시 최신순" },
  { value: "released-asc", label: "공개일시 오래된순" },
  { value: "title-asc", label: "사업명 오름차순" },
  { value: "title-desc", label: "사업명 내림차순" },
];

/** 날짜·원화 예산 범위와 저장 자료에서 확인된 업무구분 옵션을 구성한다. */
export function orderPlanFilters(businesses: readonly ListOption[]): ListFilter[] {
  return [
    { id: "released", type: "date-range", label: "공개일시" },
    { id: "business", type: "multi-select", label: "업무구분", options: businesses },
    { id: "budget", type: "number-range", label: "예산액", unit: "원" },
  ];
}

/** URL에서 발주계획 조회 조건을 읽고 지원하지 않는 값은 기본값으로 처리한다. */
export function parseOrderPlanListQuery(params: CollectionSearchParams, businesses: readonly ListOption[]): CollectionListQuery {
  const single = (key: string) => typeof params[key] === "string" ? params[key] : undefined;
  const field = single("field");
  const sort = single("sort");
  const status = single("status");
  const page = Number(single("page"));
  const business = params.business;
  const { values } = validateFilters(orderPlanFilters(businesses), {
    released: { from: single("releasedFrom"), to: single("releasedTo") },
    budget: { from: single("budgetFrom"), to: single("budgetTo") },
    business: Array.isArray(business) ? business : business ? [business] : [],
  });
  return {
    status: status === "collected" || status === "uncollected" ? status : "total",
    search: { field: orderPlanSearchFields.some((option) => option.value === field) ? field : "title", query: single("q")?.trim() ?? "" },
    filters: values,
    sort: orderPlanSortOptions.some((option) => option.value === sort) ? sort : defaultSort,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/** 발주계획의 적용 조건을 보존하는 목록 주소를 만든다. 기본값은 주소에서 생략한다. */
export function orderPlanListHref(path: string, query: CollectionListQuery): string {
  const params = new URLSearchParams();
  if (query.status !== "total") params.set("status", query.status);
  if (query.search.field !== "title") params.set("field", query.search.field);
  if (query.search.query) params.set("q", query.search.query);
  for (const id of ["released", "budget"]) {
    const range = query.filters[id];
    if (!range || !("from" in range || "to" in range)) continue;
    if (range.from !== undefined) params.set(`${id}From`, String(range.from));
    if (range.to !== undefined) params.set(`${id}To`, String(range.to));
  }
  const businesses = query.filters.business;
  if (Array.isArray(businesses)) for (const business of businesses) params.append("business", business);
  if (query.sort !== defaultSort) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params.size ? `${path}?${params}` : path;
}
