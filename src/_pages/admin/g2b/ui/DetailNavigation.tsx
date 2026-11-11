"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, List } from "lucide-react";
import { ADMIN_G2B_PATH } from "@/_pages/admin/config/routes";
import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import { Button } from "@/shared/ui/button";

/** 업무별 목록 주소를 하나의 기준 경로에서 생성한다. */
export function DetailNavigation({ section }: { section: CollectionSection }) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    // 브라우저 기록 길이만으로는 외부 사이트로 돌아가는 경우를 구분할 수 없다.
    // 동일 출처에서 진입한 사실이 확인되는 경우에만 이전 버튼을 제공한다.
    let internalReferrer = false;
    try {
      internalReferrer = Boolean(document.referrer) &&
        new URL(document.referrer).origin === window.location.origin;
    } catch {
      internalReferrer = false;
    }
    setCanGoBack(internalReferrer && window.history.length > 1);
  }, []);

  return (
    <nav aria-label="상세 페이지 이동" className="flex w-fit items-center gap-2">
      {canGoBack && (
        <Button type="button" variant="outline" aria-label="이전 페이지" title="이전 페이지" onClick={() => router.back()}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">이전 페이지</span>
        </Button>
      )}
      <Button asChild variant="outline">
        <Link href={`${ADMIN_G2B_PATH}/${section}`} aria-label="목록으로 이동" title="목록으로 이동">
          <List aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">목록으로 이동</span>
        </Link>
      </Button>
    </nav>
  );
}
