"use client";

import type { ComponentProps, ReactNode } from "react";
import { ListFilters } from "./ListFilters";
import { ListPagination } from "./ListPagination";
import { ListSearch } from "./ListSearch";
import { ListSort } from "./ListSort";

type ListViewProps = {
  search?: ComponentProps<typeof ListSearch>;
  filters?: ComponentProps<typeof ListFilters>;
  sort?: ComponentProps<typeof ListSort>;
  pagination?: ComponentProps<typeof ListPagination>;
  children: ReactNode;
};

/**
 * 검색·정렬, 필터, 결과, 페이지 이동 순서로 목록의 공통 배치를 적용한다.
 * 좁은 화면에서는 조작부가 줄바꿈되며, 설정이 없거나 옵션이 빈 조작부는 공간을 차지하지 않는다.
 * @param props.children 업무별 결과 목록과 빈 결과·로딩 등 목록 상태를 표시할 영역.
 * @param props.pagination 호출부에서 조회한 페이지 정보와 현재 조건을 보존하는 링크 생성 함수.
 */
export function ListView({ search, filters, sort, pagination, children }: ListViewProps) {
  const showSearch = search && search.fields.length > 0;
  const showSort = sort && sort.options.length > 0;

  return (
    <div className="grid min-w-0 gap-4">
      {(showSearch || showSort) && (
        <div className="flex flex-wrap items-center gap-2">
          {showSearch && <div className="min-w-0 grow"><ListSearch {...search} /></div>}
          {showSort && <div className="ml-auto"><ListSort {...sort} /></div>}
        </div>
      )}
      {filters && <ListFilters {...filters} />}
      <div className="min-w-0">{children}</div>
      {pagination && <ListPagination {...pagination} />}
    </div>
  );
}
