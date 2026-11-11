import { validateFilters } from "@/shared/ui/list-controls/model";
import type { ListFilter, ListOption } from "@/shared/ui/list-controls/model";
import type { CollectionListQuery, CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";

// 목록 제목에 표시되는 요청명과 계약요청 기본정보를 검색 대상으로 제공한다.
export const contractRequestSearchFields = [
  { value: "title", label: "요청명" },
  { value: "number", label: "요청접수번호" },
  { value: "agency", label: "수요기관명" },
  { value: "item", label: "세부품명" },
];

const defaultSort = "written-desc";
export const contractRequestSortOptions = [
  { value: defaultSort, label: "작성일자 최신순" },
  { value: "written-asc", label: "작성일자 오래된순" },
  { value: "title-asc", label: "요청명 오름차순" },
  { value: "title-desc", label: "요청명 내림차순" },
];

/** 작성일자 범위와 저장 자료에서 확인된 업무구분 옵션을 구성한다. */
export function contractRequestFilters(businesses: readonly ListOption[]): ListFilter[] {
  return [
    { id: "written", type: "date-range", label: "작성일자" },
    { id: "business", type: "multi-select", label: "업무구분", options: businesses },
  ];
}

/** URL에서 계약요청 조회 조건을 읽고 지원하지 않는 값은 기본값으로 처리한다. */
export function parseContractRequestListQuery(params: CollectionSearchParams, businesses: readonly ListOption[]): CollectionListQuery {
  const single = (key: string) => typeof params[key] === "string" ? params[key] : undefined;
  const field = single("field");
  const sort = single("sort");
  const status = single("status");
  const page = Number(single("page"));
  const business = params.business;
  const { values } = validateFilters(contractRequestFilters(businesses), {
    written: { from: single("writtenFrom"), to: single("writtenTo") },
    business: Array.isArray(business) ? business : business ? [business] : [],
  });
  return {
    status: status === "collected" || status === "uncollected" ? status : "total",
    search: { field: contractRequestSearchFields.some((option) => option.value === field) ? field : "title", query: single("q")?.trim() ?? "" },
    filters: values,
    sort: contractRequestSortOptions.some((option) => option.value === sort) ? sort : defaultSort,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/** 계약요청의 적용 조건을 보존하는 목록 주소를 만든다. 기본값은 주소에서 생략한다. */
export function contractRequestListHref(path: string, query: CollectionListQuery): string {
  const params = new URLSearchParams();
  if (query.status !== "total") params.set("status", query.status);
  if (query.search.field !== "title") params.set("field", query.search.field);
  if (query.search.query) params.set("q", query.search.query);
  const range = query.filters.written;
  if (range && ("from" in range || "to" in range)) {
    if (range.from !== undefined) params.set("writtenFrom", String(range.from));
    if (range.to !== undefined) params.set("writtenTo", String(range.to));
  }
  const businesses = query.filters.business;
  if (Array.isArray(businesses)) for (const business of businesses) params.append("business", business);
  if (query.sort !== defaultSort) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params.size ? `${path}?${params}` : path;
}
