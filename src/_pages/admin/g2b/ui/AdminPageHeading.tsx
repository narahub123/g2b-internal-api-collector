import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/shared/ui/button";

type AdminPageHeadingProps = {
  /** 페이지에 표시할 제목. */
  title: string;
  /** 돌아가기 버튼이 이동할 내부 경로. */
  backHref: string;
  /** 돌아가기 버튼에 표시할 문구. */
  backLabel: string;
};

/**
 * 관리자 페이지의 제목과 상위 페이지 이동 버튼을 표시한다.
 * @param props.title 현재 페이지의 제목.
 * @param props.backHref 상위 페이지의 내부 경로.
 * @param props.backLabel 돌아가기 버튼의 문구.
 * @returns 제목과 상위 페이지 이동 버튼으로 구성된 공통 헤더.
 */
export function AdminPageHeading({
  title,
  backHref,
  backLabel,
}: AdminPageHeadingProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <Button asChild variant="outline">
        <Link href={backHref}>
          <ArrowLeft aria-hidden="true" />
          {backLabel}
        </Link>
      </Button>
    </header>
  );
}
