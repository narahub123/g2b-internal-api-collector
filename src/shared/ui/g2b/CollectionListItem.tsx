import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * 업무 목록 한 건의 테두리와 여백을 공통으로 적용한다.
 * 상세 링크와 재수집 버튼은 각각 포커스하고 실행할 수 있다.
 */
export function CollectionListItem({ href, children, status, action }: {
  href?: string;
  children: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
}) {
  const contentClass = "flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm font-medium";
  return (
    <li className="rounded-md border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between">
        {href ? (
          <Link href={href} prefetch={false}
            className={cn(contentClass, "rounded-md hover:bg-muted/50 focus-visible:outline-ring")}>
            {children}
          </Link>
        ) : <div className={contentClass}>{children}</div>}
        {action && <div className="px-4 py-2">{action}</div>}
      </div>
      {status && <div className="border-t px-4 py-2 text-sm">{status}</div>}
    </li>
  );
}
