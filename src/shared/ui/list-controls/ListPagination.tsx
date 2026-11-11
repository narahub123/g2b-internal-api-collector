import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Pagination, PaginationContent, PaginationItem } from "@/shared/ui/pagination";
import { getPageNumbers } from "./model";

/** 이동할 수 있는 항목은 링크로, 경계의 이동 항목은 비활성 버튼으로 렌더링한다. */
function PageControl({ href, label, current, children }: {
  href?: string;
  label: string;
  current?: boolean;
  children: ReactNode;
}) {
  const variant = current ? "outline" : "ghost";
  const className = "min-w-8 px-1.5";

  return (
    <PaginationItem>
      {href === undefined ? (
        <Button type="button" variant={variant} size="sm" className={className} aria-label={label} disabled>
          {children}
        </Button>
      ) : (
        <Button asChild variant={variant} size="sm" className={className}>
          <Link href={href} prefetch={false} aria-label={label} aria-current={current ? "page" : undefined}>
            {children}
          </Link>
        </Button>
      )}
    </PaginationItem>
  );
}

/**
 * 처음·이전·숫자·다음·마지막 순서로 목록의 페이지 이동을 제공한다.
 * 전체 페이지가 1 이하이면 렌더링하지 않으며, 현재 페이지는 유효 범위로 보정한다.
 * @param props.page 1부터 시작하는 현재 페이지.
 * @param props.hrefForPage 검색·필터 등 기존 조건을 보존한 목적지 링크를 만드는 함수.
 */
export function ListPagination({ page, totalPages, hrefForPage }: {
  page: number;
  totalPages: number;
  hrefForPage: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  const current = Math.min(totalPages, Math.max(1, page));
  const canGoBack = current > 1;
  const canGoForward = current < totalPages;

  return (
    <Pagination>
      <PaginationContent>
        <PageControl href={canGoBack ? hrefForPage(1) : undefined} label="처음으로">
          <ChevronsLeft aria-hidden="true" />
          <span className="hidden sm:inline">처음으로</span>
        </PageControl>
        <PageControl href={canGoBack ? hrefForPage(current - 1) : undefined} label="이전">
          <ChevronLeft aria-hidden="true" />
          <span className="hidden sm:inline">이전</span>
        </PageControl>
        {getPageNumbers(current, totalPages).map((number) => (
          <PageControl key={number} href={hrefForPage(number)} label={`${number} 페이지`} current={number === current}>
            {number}
          </PageControl>
        ))}
        <PageControl href={canGoForward ? hrefForPage(current + 1) : undefined} label="다음">
          <span className="hidden sm:inline">다음</span>
          <ChevronRight aria-hidden="true" />
        </PageControl>
        <PageControl href={canGoForward ? hrefForPage(totalPages) : undefined} label="마지막으로">
          <span className="hidden sm:inline">마지막으로</span>
          <ChevronsRight aria-hidden="true" />
        </PageControl>
      </PaginationContent>
    </Pagination>
  );
}
