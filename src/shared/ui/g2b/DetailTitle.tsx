import type { ReactNode } from "react";
import { decodeHTMLStrict } from "entities";
import { ExternalLink } from "lucide-react";
import type { G2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { BusinessBadge } from "./BusinessBadge";

/**
 * 상세 제목 영역에 전달할 표시 정보와 선택적 작업 요소.
 * 원본 링크는 주소가 제공된 경우에만 표시하며, 작업 버튼은 호출 측에서 전달한다.
 */
interface DetailTitleProps {
  title: string;
  subtitle: string;
  business?: G2bBusiness;
  originalHref?: string;
  headingLevel?: "h1" | "h2";
  actions?: ReactNode;
  /** 제목 줄 오른쪽에 고정할 관심 버튼이다. */
  interest?: ReactNode;
}

/**
 * 상세 페이지의 제목과 보조 정보를 표시하고 선택적으로 원본 링크 및 작업 버튼을 배치한다.
 * 제목은 저장된 원본 문자열을 변경하지 않고 표시 시점에 HTML 엔티티를 디코딩한다.
 * 원본 주소가 제공되면 새 탭에서 열 수 있는 링크를 표시하며, 작업 버튼의 동작은 호출 측에서 관리한다.
 *
 * @param props 제목·보조 정보, 제목 수준, 원본 링크, 작업 버튼 및 관심 버튼
 * @returns 모바일과 데스크톱 배치가 적용된 상세 제목 영역
 */
export function DetailTitle({
  title,
  subtitle,
  business,
  originalHref,
  headingLevel = "h2",
  actions,
  interest,
}: DetailTitleProps) {
  // 상세의 문서 구조에 맞게 호출부가 선택한 제목 수준을 적용한다.
  const Heading = headingLevel;

  return (
    <header className="flex min-w-0 items-start gap-2">
      {/* 기존 제목과 작업 영역을 하나로 묶어 별 버튼을 화면 크기와 관계없이 가장 오른쪽에 둔다. */}
      <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <Heading className="wrap-anywhere text-xl font-semibold">
            {decodeHTMLStrict(title)}
          </Heading>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="min-w-0 wrap-anywhere">{subtitle}</span>
            <BusinessBadge business={business} />
          </p>
        </div>
        {/* 원본 주소나 작업 요소가 없으면 빈 버튼 영역을 만들지 않는다. */}
        {(originalHref || actions) && (
          <div className="flex min-w-0 flex-wrap items-start gap-2 sm:justify-end">
            {originalHref && (
              <a
                href={originalHref}
                target="_blank"
                rel="noopener noreferrer"
                title="나라장터 원본 페이지 열기"
                aria-label="나라장터 원본 페이지 열기"
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-9 sm:px-0"
              >
                <ExternalLink aria-hidden="true" className="size-4" />
                <span className="sm:hidden">나라장터</span>
              </a>
            )}
            {actions}
          </div>
        )}
      </div>
      {/* 등록할 수 있는 상세에서만 전달된 관심 버튼을 표시한다. */}
      {interest}
    </header>
  );
}
