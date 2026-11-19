import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Pagination, PaginationContent, PaginationItem } from "@/shared/ui/pagination";
import { getPageNumbers } from "./model";

/** 화면의 이동 방식에 맞는 링크나 버튼을 렌더링하고 경계 항목을 비활성화한다. */
function PageControl({ href, label, current, shallow, onClick, children }: {
  href?: string;
  label: string;
  current?: boolean;
  shallow?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const variant = current ? "outline" : "ghost";
  const className = "min-w-8 px-1.5";

  return (
    <PaginationItem>
      {href === undefined ? (
        <Button type="button" variant={variant} size="sm" className={className} title={label} aria-label={label}
          aria-current={current ? "page" : undefined} disabled={!onClick} onClick={onClick}>
          {children}
        </Button>
      ) : (
        <Button asChild variant={variant} size="sm" className={className}>
          <Link href={href} prefetch={false} title={label} aria-label={label} aria-current={current ? "page" : undefined}
            onNavigate={shallow ? (event) => {
              event.preventDefault();
              window.history.pushState(null, "", href);
            } : undefined}>
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
 * @param props.onPageChange 주소를 유지하는 화면에서 선택한 페이지를 적용하는 콜백.
 * @param props.shallow 목록 API를 따로 조회하는 화면에서 같은 화면의 주소만 갱신한다.
 */
export function ListPagination({ page, totalPages, hrefForPage, shallow, onPageChange }: {
  page: number;
  totalPages: number;
  shallow?: boolean;
} & (
  | { hrefForPage: (page: number) => string; onPageChange?: never }
  | { onPageChange: (page: number) => void; hrefForPage?: never }
)) {
  if (totalPages <= 1) return null;
  const current = Math.min(totalPages, Math.max(1, page));
  const canGoBack = current > 1;
  const canGoForward = current < totalPages;
  const destination = (page?: number) => ({
    href: page === undefined ? undefined : hrefForPage?.(page),
    onClick: page === undefined || !onPageChange ? undefined : () => onPageChange(page),
  });

  return (
    <Pagination>
      <PaginationContent>
        <PageControl shallow={shallow} {...destination(canGoBack ? 1 : undefined)} label="처음으로">
          <ChevronsLeft aria-hidden="true" />
        </PageControl>
        <PageControl shallow={shallow} {...destination(canGoBack ? current - 1 : undefined)} label="이전">
          <ChevronLeft aria-hidden="true" />
        </PageControl>
        {getPageNumbers(current, totalPages).map((number) => (
          <PageControl key={number} shallow={shallow} {...destination(number)} label={`${number} 페이지`} current={number === current}>
            {number}
          </PageControl>
        ))}
        <PageControl shallow={shallow} {...destination(canGoForward ? current + 1 : undefined)} label="다음">
          <ChevronRight aria-hidden="true" />
        </PageControl>
        <PageControl shallow={shallow} {...destination(canGoForward ? totalPages : undefined)} label="마지막으로">
          <ChevronsRight aria-hidden="true" />
        </PageControl>
      </PaginationContent>
    </Pagination>
  );
}

/** 전체 페이지 수를 집계하지 않는 목록에 이전·다음 링크를 제공한다. */
export function ListCursorPagination({ previousHref, nextHref }: {
  previousHref?: string;
  nextHref?: string;
}) {
  if (!previousHref && !nextHref) return null;
  return (
    <Pagination>
      <PaginationContent>
        <PageControl href={previousHref} shallow label="이전"><ChevronLeft aria-hidden="true" /></PageControl>
        <PageControl href={nextHref} shallow label="다음"><ChevronRight aria-hidden="true" /></PageControl>
      </PaginationContent>
    </Pagination>
  );
}
