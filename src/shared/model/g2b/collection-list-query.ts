import type { ListFilterValues, ListSearchValue } from "@/shared/ui/list-controls/model";

// 업무 목록에서 URL과 저장소 사이에 전달하는 공통 조회 조건.
export type CollectionSearchParams = Record<string, string | string[] | undefined>;
export type CollectionListQuery = {
  status: "total" | "collected" | "uncollected";
  search: ListSearchValue;
  filters: ListFilterValues;
  sort: string;
  page: number;
};
