"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  noticeFilterDefinitions,
  noticeListHref,
  noticeSearchFields,
  noticeSortOptions,
} from "@/entities/notice/model/notice-list-query";
import type { NoticeListQuery } from "@/entities/notice/model/notice-list-query";
import { ListView } from "@/shared/ui/list-controls/ListView";

/** 입찰공고 조회 조건을 URL로 이동시키고 공통 목록에 서버에서 조회한 결과를 표시한다. */
export function NoticeListView({ path, query, totalPages, regions, children }: {
  path: string;
  query: NoticeListQuery;
  totalPages: number;
  regions: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const apply = (changes: Partial<NoticeListQuery>) => {
    router.push(noticeListHref(path, { ...query, ...changes, page: 1 }));
  };

  return (
    <ListView
      search={{ fields: noticeSearchFields, defaultField: "title", value: query.search, onSubmit: (search) => apply({ search }) }}
      filters={{ filters: noticeFilterDefinitions(regions), value: query.filters, onApply: (filters) => apply({ filters }) }}
      sort={{ options: noticeSortOptions, value: query.sort, onChange: (sort) => apply({ sort }) }}
      pagination={{ page: query.page, totalPages, hrefForPage: (page) => noticeListHref(path, { ...query, page }) }}
    >
      {children}
    </ListView>
  );
}
