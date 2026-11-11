"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { ListOption } from "@/shared/ui/list-controls/model";
import { orderPlanFilters, orderPlanListHref, orderPlanSearchFields, orderPlanSortOptions } from "@/entities/order-plan/model/order-plan-list-query";
import {
  noticeFilterDefinitions,
  noticeListHref,
  noticeSearchFields,
  noticeSortOptions,
} from "@/entities/notice/model/notice-list-query";
import type { CollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import { ListView } from "@/shared/ui/list-controls/ListView";

/** 업무별 조회 조건을 URL로 이동시키고 공통 목록에 서버에서 조회한 결과를 표시한다. */
export function CollectionQueryView({ path, query, totalPages, children, ...options }: {
  path: string;
  query: CollectionListQuery;
  totalPages: number;
  children: ReactNode;
} & ({ section: "notices"; regions: string[] } | { section: "order-plans"; businesses: ListOption[] })) {
  const router = useRouter();
  const config = options.section === "notices"
    ? { href: noticeListHref, fields: noticeSearchFields, sort: noticeSortOptions, filters: noticeFilterDefinitions(options.regions) }
    : { href: orderPlanListHref, fields: orderPlanSearchFields, sort: orderPlanSortOptions, filters: orderPlanFilters(options.businesses) };
  const apply = (changes: Partial<CollectionListQuery>) => {
    router.push(config.href(path, { ...query, ...changes, page: 1 }));
  };

  return (
    <ListView
      controlsLabel="검색·필터·정렬"
      onReset={() => router.push(path)}
      search={{ fields: config.fields, defaultField: "title", value: query.search, onSubmit: (search) => apply({ search }) }}
      filters={{ filters: config.filters, value: query.filters, onApply: (filters) => apply({ filters }) }}
      sort={{ options: config.sort, value: query.sort, onChange: (sort) => apply({ sort }) }}
      pagination={{ page: query.page, totalPages, hrefForPage: (page) => config.href(path, { ...query, page }) }}
    >
      {children}
    </ListView>
  );
}
