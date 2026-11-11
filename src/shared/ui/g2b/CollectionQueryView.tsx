"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { ListOption } from "@/shared/ui/list-controls/model";
import {
  contractRequestFilters,
  contractRequestListHref,
  contractRequestSearchFields,
  contractRequestSortOptions,
} from "@/entities/contract-request/model/contract-request-list-query";
import { orderPlanFilters, orderPlanListHref, orderPlanSearchFields, orderPlanSortOptions } from "@/entities/order-plan/model/order-plan-list-query";
import {
  noticeFilterDefinitions,
  noticeListHref,
  noticeSearchFields,
  noticeSortOptions,
} from "@/entities/notice/model/notice-list-query";
import { collectionListHref, type CollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import { priorSpecListControls } from "@/entities/prior-spec/model/prior-spec-list-query";
import { openingResultListControls } from "@/entities/opening-result/model/opening-result-list-query";
import { contractListControls } from "@/entities/contract/model/contract-list-query";
import { ListView } from "@/shared/ui/list-controls/ListView";

// 각 업무의 검색 항목과 필터 정의는 해당 업무 모듈이 소유한다.
const listControls = {
  "prior-specs": priorSpecListControls,
  "opening-results": openingResultListControls,
  contracts: contractListControls,
};

/**
 * 업무별 조회 조건을 URL로 이동시키고 공통 목록에 서버에서 조회한 결과를 표시한다.
 * @param props.persistentParams 탭 선택처럼 조건 변경, 페이지 이동, 전체 초기화에도 유지할 URL 값.
 */
export function CollectionQueryView({ path, query, totalPages, persistentParams, children, ...options }: {
  path: string;
  query: CollectionListQuery;
  totalPages: number;
  persistentParams?: Record<string, string>;
  children: ReactNode;
} & ({ section: "notices"; regions: string[] } | { section: "order-plans" | "contract-requests" | keyof typeof listControls }) & { businesses: ListOption[] }) {
  const router = useRouter();
  const config = options.section === "notices"
    ? { href: noticeListHref, fields: noticeSearchFields, sort: noticeSortOptions, filters: noticeFilterDefinitions(options.regions, options.businesses) }
    : options.section === "contract-requests"
      ? { href: contractRequestListHref, fields: contractRequestSearchFields, sort: contractRequestSortOptions, filters: contractRequestFilters(options.businesses) }
      : options.section === "order-plans"
        ? { href: orderPlanListHref, fields: orderPlanSearchFields, sort: orderPlanSortOptions, filters: orderPlanFilters(options.businesses) }
        : { href: collectionListHref, ...listControls[options.section](options.businesses) };
  const href = (nextQuery?: CollectionListQuery) => {
    const listHref = nextQuery ? config.href(path, nextQuery) : path;
    if (!persistentParams) return listHref;

    const params = new URLSearchParams(listHref.split("?")[1]);
    for (const [key, value] of Object.entries(persistentParams)) params.set(key, value);
    return `${path}?${params}`;
  };
  const apply = (changes: Partial<CollectionListQuery>) => {
    router.push(href({ ...query, ...changes, page: 1 }));
  };

  return (
    <ListView
      controlsLabel="검색·필터·정렬"
      onReset={() => router.push(href())}
      search={{ fields: config.fields, defaultField: "title", value: query.search, onSubmit: (search) => apply({ search }) }}
      filters={{ filters: config.filters, value: query.filters, onApply: (filters) => apply({ filters }) }}
      sort={{ options: config.sort, value: query.sort, onChange: (sort) => apply({ sort }) }}
      pagination={{ page: query.page, totalPages, hrefForPage: (page) => href({ ...query, page }) }}
    >
      {children}
    </ListView>
  );
}
