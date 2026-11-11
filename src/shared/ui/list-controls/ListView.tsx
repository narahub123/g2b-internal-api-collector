"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/shared/ui/accordion";
import { Button } from "@/shared/ui/button";
import { ListFilters } from "./ListFilters";
import { ListPagination } from "./ListPagination";
import { ListSearch } from "./ListSearch";
import { ListSort } from "./ListSort";

type ListViewProps = {
  search?: ComponentProps<typeof ListSearch>;
  filters?: ComponentProps<typeof ListFilters>;
  sort?: ComponentProps<typeof ListSort>;
  pagination?: ComponentProps<typeof ListPagination>;
  controlsLabel?: string;
  onReset?: () => void;
  children: ReactNode;
};

/**
 * 검색·정렬, 필터, 결과, 페이지 이동 순서로 목록의 공통 배치를 적용한다.
 * 좁은 화면에서는 조작부가 줄바꿈되며, 설정이 없거나 옵션이 빈 조작부는 공간을 차지하지 않는다.
 * @param props.children 업무별 결과 목록과 빈 결과·로딩 등 목록 상태를 표시할 영역.
 * @param props.pagination 호출부에서 조회한 페이지 정보와 현재 조건을 보존하는 링크 생성 함수.
 * @param props.controlsLabel 지정하면 검색·필터·정렬을 처음에는 닫힌 아코디언에 표시한다.
 * @param props.onReset 전체 조회 조건을 기본값으로 되돌리는 콜백. 편집 중인 입력도 함께 지운다.
 */
export function ListView({ search, filters, sort, pagination, controlsLabel, onReset, children }: ListViewProps) {
  const [resetVersion, setResetVersion] = useState(0);
  const showSearch = search && search.fields.length > 0;
  const showSort = sort && sort.options.length > 0;
  const showFilters = filters && filters.filters.length > 0;

  const controls = (showSearch || showSort || showFilters || onReset) && (
    <div className="grid min-w-0 gap-4">
      {(showSearch || showSort) && (
        <div className="flex flex-wrap items-center gap-2">
          {showSearch && <div className="min-w-0 grow"><ListSearch key={resetVersion} {...search} /></div>}
          {showSort && <div className="ml-auto"><ListSort {...sort} /></div>}
        </div>
      )}
      {showFilters && <ListFilters key={resetVersion} {...filters} resetLabel={onReset ? "필터 초기화" : filters.resetLabel} />}
      {onReset && (
        <Button type="button" variant="outline" className="justify-self-end" onClick={() => {
          // URL이 이미 기본 상태인 경우에도 검색·필터의 미적용 입력을 폐기한다.
          setResetVersion((version) => version + 1);
          onReset();
        }}>전체 초기화</Button>
      )}
    </div>
  );

  return (
    <div className="grid min-w-0 gap-4">
      {controls && (controlsLabel ? (
        <Accordion type="single" collapsible className="min-w-0 rounded-xl border bg-card px-4">
          <AccordionItem value="controls">
            <AccordionTrigger heading="h2">{controlsLabel}</AccordionTrigger>
            <AccordionContent>{controls}</AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : controls)}
      <div className="min-w-0">{children}</div>
      {pagination && <ListPagination {...pagination} />}
    </div>
  );
}
