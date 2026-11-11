import { validateFilters } from "@/shared/ui/list-controls/model";
import type { ListFilter, ListFilterValues, ListOption, ListSearchValue } from "@/shared/ui/list-controls/model";

// 업무 목록에서 URL과 저장소 사이에 전달하는 공통 조회 조건.
export type CollectionSearchParams = Record<string, string | string[] | undefined>;
export type CollectionListQuery = {
  status: "total" | "collected" | "uncollected";
  search: ListSearchValue;
  filters: ListFilterValues;
  sort: string;
  page: number;
};

/** 업무 목록에 공고 차수와 개찰 차수가 있는 경우 식별번호에 함께 표시한다. */
export function formatCollectionIdentifier({ number, revision, openingRevision }: {
  number: string;
  revision: string;
  openingRevision: string;
}) {
  return [number, revision, openingRevision && `개찰 ${openingRevision}차`]
    .filter(Boolean)
    .join("/");
}

/** 지원하는 조건만 URL에서 읽어 검증한다. 날짜 최신순과 1페이지를 기본값으로 사용한다. */
export function parseCollectionListQuery(params: CollectionSearchParams, config: { fields: readonly ListOption[]; filters: readonly ListFilter[]; sort: readonly ListOption[] }): CollectionListQuery {
  const single = (key: string) => typeof params[key] === "string" ? params[key] : undefined;
  const field = single("field");
  const sort = single("sort");
  const status = single("status");
  const page = Number(single("page"));
  const draft = Object.fromEntries(config.filters.map(({ id, type }) => [
    id,
    type === "multi-select" ? [params[id] ?? []].flat() : { from: single(`${id}From`), to: single(`${id}To`) },
  ]));
  return {
    status: status === "collected" || status === "uncollected" ? status : "total",
    search: { field: config.fields.some((option) => option.value === field) ? field : "title", query: single("q")?.trim() ?? "" },
    filters: validateFilters(config.filters, draft).values,
    sort: config.sort.some((option) => option.value === sort) ? sort : "date-desc",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

/** 검색·필터·정렬 조건을 목록 URL에 보존하고 기본값은 생략한다. */
export function collectionListHref(path: string, query: CollectionListQuery): string {
  const params = new URLSearchParams();
  if (query.status !== "total") params.set("status", query.status);
  if (query.search.field !== "title") params.set("field", query.search.field);
  if (query.search.query) params.set("q", query.search.query);
  for (const [id, value] of Object.entries(query.filters)) {
    if (Array.isArray(value)) {
      for (const option of value) params.append(id, option);
    } else if ("from" in value || "to" in value) {
      if (value.from !== undefined) params.set(`${id}From`, String(value.from));
      if (value.to !== undefined) params.set(`${id}To`, String(value.to));
    }
  }
  if (query.sort !== "date-desc") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params.size ? `${path}?${params}` : path;
}
