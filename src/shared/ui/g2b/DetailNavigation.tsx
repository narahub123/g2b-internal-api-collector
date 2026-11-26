"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, List } from "lucide-react";
import { Button } from "@/shared/ui/button";

/** 브라우저가 같은 출처 문서에 제공하는 탐색 기록 중 상세에서 사용하는 부분이다. */
type AppNavigation = EventTarget & {
  /** 현재 주소의 기록 인덱스다. */
  currentEntry: { index: number } | null;
  /** 접근 가능한 탐색 기록 순서와 주소를 반환한다. */
  entries(): { url?: string; sameDocument: boolean }[];
};

/**
 * 앱 내부의 직전 기록으로 가는 버튼과 일반 업무 목록 링크를 제공한다.
 * @param props.listHref 상세를 연 화면에 맞는 일반 업무 목록 주소.
 * @returns 두 화면에서 공유하는 상세 탐색 영역.
 */
export function DetailNavigation({ listHref }: { listHref: string }) {
  // 라우터는 브라우저의 실제 직전 기록으로 복귀하는 데 사용한다.
  const router = useRouter();
  // 같은 컴포넌트 인스턴스로 다른 상세에 이동한 경우에도 기록을 확인한다.
  const pathname = usePathname();
  // 서버 렌더링에서는 이전 기록이 확인될 때까지 버튼을 숨긴다.
  const [verifiedPath, setVerifiedPath] = useState<string>();

  useEffect(() => {
    // 문서 referrer 대신 실제 기록의 직전 항목을 확인할 수 있는 브라우저 API를 사용한다.
    const navigation = (window as Window & { navigation?: AppNavigation }).navigation;
    if (!navigation) return;
    // 화면을 떠난 뒤 예약된 기록 확인이 이전 컴포넌트에 반영되는 것을 막는다.
    let active = true;

    /** 직전 기록이 실제 앱 탐색인지 확인하고 상세 주소에 표시 상태를 연결한다. */
    function checkPreviousEntry() {
      // 이미 다른 화면으로 이동했으면 이 상세의 표시 상태를 변경하지 않는다.
      if (!active) return;
      // 첫 기록이거나 이전 기록의 주소가 노출되지 않으면 앱 이동으로 판단하지 않는다.
      const index = navigation?.currentEntry?.index ?? -1;
      const previous = index > 0 ? navigation?.entries()[index - 1] : undefined;
      // 앱 라우터 이동은 같은 문서 기록이다. 문서를 다시 열었다면 직전 주소와 referrer가 일치해야 한다.
      const internal = previous?.url && new URL(previous.url).origin === window.location.origin &&
        (previous.sameDocument || previous.url.split("#")[0] === document.referrer);
      // 주소창 직접 진입이나 외부 경유를 제외하고 확인한 상세 경로에서만 버튼을 표시한다.
      setVerifiedPath(internal ? pathname : undefined);
    }

    /** Next.js가 브라우저 기록을 변경하는 커밋이 끝난 뒤 이전 기록을 확인한다. */
    function schedulePreviousEntryCheck() {
      // 기록 변경 이벤트가 React의 삽입 효과에서 동기적으로 발생해도 상태 변경은 다음 작업으로 미룬다.
      queueMicrotask(checkPreviousEntry);
    }

    // 초기 기록과 앞으로·뒤로 가기 등의 기록 변경을 함께 확인한다.
    checkPreviousEntry();
    navigation.addEventListener("currententrychange", schedulePreviousEntryCheck);
    // 상세가 바뀌거나 닫히면 기존 기록 이벤트 구독을 해제한다.
    return () => {
      active = false;
      navigation.removeEventListener("currententrychange", schedulePreviousEntryCheck);
    };
  }, [pathname]);

  /** 앱 내부 진입이 확인된 상세에서 브라우저의 직전 기록으로 돌아간다. */
  function goBack() {
    // 기록 복귀는 필터가 있는 목록과 상세 간 이동에 동일하게 적용한다.
    router.back();
  }

  // 일반 목록은 항상 제공하고 이전 버튼은 해당 경로의 기록이 확인된 뒤 표시한다.
  return (
    <nav aria-label="상세 페이지 이동" className="flex w-fit items-center gap-2">
      {verifiedPath === pathname && (
        <Button type="button" variant="outline" aria-label="이전 페이지" title="이전 페이지" onClick={goBack}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">이전 페이지</span>
        </Button>
      )}
      <Button asChild variant="outline">
        <Link href={listHref} prefetch={false} aria-label="목록으로 이동" title="목록으로 이동">
          <List aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">목록으로 이동</span>
        </Link>
      </Button>
    </nav>
  );
}
