"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ListView } from "@/shared/ui/list-controls/ListView";
import type { ListFilter, ListFilterValues, ListOption, ListSearchValue } from "@/shared/ui/list-controls/model";

/** 서버에서 정규화한 목록 조건과 현재 페이지의 표시 영역이다. */
type Props = {
  /** 상세 화면의 기준 경로. */
  href: string;
  /** 선택 가능한 검색 대상. */
  fields: readonly ListOption[];
  /** 현재 주소에 적용한 검색값. */
  search: ListSearchValue;
  /** 업무에 맞는 선택지 목록. */
  filters: readonly ListFilter[];
  /** 서버에서 검증한 선택값. */
  values: ListFilterValues;
  /** 서버에서 보정한 페이지 번호. */
  page: number;
  /** 조건에 일치하는 전체 페이지 수. */
  totalPages: number;
  /** 현재 페이지에 렌더링할 서버 결과. */
  children: ReactNode;
};

/**
 * 공용 목록 조작부를 주소 기반 서버 조회와 연결한다.
 * @param props 현재 검색·필터·페이지 상태와 결과 영역.
 * @returns 주소 기반 검색, 필터, 페이지 이동을 제공하는 목록.
 */
export function DictionaryListControls({ href, fields, search, filters, values, page, totalPages, children }: Props) {
  const router = useRouter();
  /**
   * 조건이 있는 경우에만 URL에 담아 직접 진입과 뒤로 가기를 지원한다.
   * @param input 적용할 검색값.
   * @param choices 적용할 필터값.
   * @param nextPage 이동할 페이지.
   * @returns 현재 사전 상세의 주소.
   */
  function address(input: ListSearchValue, choices: ListFilterValues, nextPage: number) {
    const params = new URLSearchParams();
    if (input.field !== fields[0].value) params.set("field", input.field);
    if (input.query) params.set("q", input.query);
    for (const [key, options] of Object.entries(choices)) {
      if (Array.isArray(options)) for (const value of options) params.append(key, value);
    }
    if (nextPage > 1) params.set("page", String(nextPage));
    return params.size ? `${href}?${params}` : href;
  }

  // 적용과 초기화는 첫 페이지로 보내고 페이지 링크는 그대로 조건을 전달한다.
  return (
    <ListView
      search={{ fields, defaultField: fields[0].value, value: search, onSubmit: (input) => router.push(address(input, values, 1)) }}
      filters={{ filters, value: values, onApply: (choices) => router.push(address(search, choices, 1)) }}
      onReset={() => router.push(href)}
      pagination={{ page, totalPages, hrefForPage: (nextPage) => address(search, values, nextPage) }}
    >
      {children}
    </ListView>
  );
}
