import { validateFilters } from "@/shared/ui/list-controls/model";
import type { ListFilter, ListOption } from "@/shared/ui/list-controls/model";
import type { CollectionListQuery, CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";

export type NoticeSearchParams = CollectionSearchParams;

export const noticeSearchFields = [
  { value: "title", label: "공고명" },
  { value: "number", label: "공고번호" },
  { value: "agency", label: "수요기관" },
];

const sortFields = [
  ["posted", "공고게시일", "최신순", "오래된순"],
  ["submission", "입찰서 제출일", "최신순", "오래된순"],
  ["deadline", "입찰서 제출 종료일", "최신순", "오래된순"],
  ["title", "공고명", "내림차순", "오름차순"],
  ["budget", "배정예산", "높은순", "낮은순"],
] as const;

export const noticeSortOptions = sortFields.flatMap(([field, label, desc, asc]) => [
  { value: `${field}-desc`, label: `${label} ${desc}` },
  { value: `${field}-asc`, label: `${label} ${asc}` },
]);

export type NoticeListQuery = CollectionListQuery;

/** 저장된 공고에 표시된 지역만 옵션으로 제공하고, 날짜와 금액의 입력 단위를 지정한다. */
export function noticeFilterDefinitions(regions: readonly string[], businesses: readonly ListOption[]): ListFilter[] {
  return [
    { id: "business", type: "multi-select", label: "업무구분", options: businesses },
    { id: "posted", type: "date-range", label: "공고게시일" },
    { id: "submission", type: "date-range", label: "입찰서 제출일(시작일)" },
    { id: "budget", type: "number-range", label: "배정예산", unit: "원" },
    { id: "region", type: "multi-select", label: "참가 가능 지역", options: regions.map((region) => ({ value: region, label: region })) },
  ];
}

/** URL에서 지원하는 검색·필터·정렬만 읽고 잘못된 조건은 제외한다. */
export function parseNoticeListQuery(params: NoticeSearchParams, regions: readonly string[], businesses: readonly ListOption[]): NoticeListQuery {
  const single = (key: string) => typeof params[key] === "string" ? params[key] as string : undefined;
  const field = single("field");
  const sort = single("sort");
  const status = single("status");
  const page = Number(single("page"));
  const region = params.region;
  const business = params.business;
  const { values } = validateFilters(noticeFilterDefinitions(regions, businesses), {
    business: Array.isArray(business) ? business : business ? [business] : [],
    posted: { from: single("postedFrom"), to: single("postedTo") },
    submission: { from: single("submissionFrom"), to: single("submissionTo") },
    budget: { from: single("budgetFrom"), to: single("budgetTo") },
    region: Array.isArray(region) ? region : region ? [region] : [],
  });
  return {
    status: status === "collected" || status === "uncollected" ? status : "total",
    search: { field: noticeSearchFields.some((item) => item.value === field) ? field : "title", query: single("q")?.trim() ?? "" },
    filters: values,
    sort: noticeSortOptions.some((item) => item.value === sort) ? sort : "posted-desc",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/** 적용된 조건을 URL에 직렬화한다. 기본 상태는 생략하고 지역은 반복 파라미터로 기록한다. */
export function noticeListHref(path: string, query: NoticeListQuery): string {
  const params = new URLSearchParams();
  if (query.status !== "total") params.set("status", query.status);
  if (query.search.field !== "title") params.set("field", query.search.field);
  if (query.search.query) params.set("q", query.search.query);
  for (const id of ["posted", "submission", "budget"]) {
    const range = query.filters[id];
    if (!range || !("from" in range || "to" in range)) continue;
    if (range.from !== undefined) params.set(`${id}From`, String(range.from));
    if (range.to !== undefined) params.set(`${id}To`, String(range.to));
  }
  for (const id of ["business", "region"]) {
    const selected = query.filters[id];
    if (Array.isArray(selected)) for (const value of selected) params.append(id, value);
  }
  if (query.sort !== "posted-desc") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  const serialized = params.toString();
  return serialized ? `${path}?${serialized}` : path;
}
