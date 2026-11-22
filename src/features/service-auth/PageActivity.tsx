"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AUTH_ERROR_PATH, isReturnablePage, parseInternalPage } from "@/shared/config/page-access";
import { resolvePageReturn } from "./page-actions";
import { renewPageSession } from "./renew-page-session";
import { withSessionCookieWrite } from "./session-writes";

/** 브라우저 탭에서만 공유하는 최근 내부 페이지 기록 키. */
const historyKey = "g2b-page-history";

/**
 * 탭에 남은 정상 페이지 기록을 읽는다.
 * @returns 세션 저장소를 사용하지 못하면 빈 기록, 사용 가능하면 저장된 기록.
 */
function readHistory(): string[] {
  try {
    const data: unknown = JSON.parse(sessionStorage.getItem(historyKey) ?? "[]");
    return Array.isArray(data) ? data.filter((value) => typeof value === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

/**
 * 확인된 방문을 탭 기록 맨 앞에 둔다. 탭 저장 기능이 차단돼도 화면 이용에 영향이 없다.
 * @param location 현재 정상 표시된 내부 페이지와 검색 조건.
 */
function remember(location: string) {
  try {
    sessionStorage.setItem(historyKey, JSON.stringify([location, ...readHistory().filter((page) => page !== location)].slice(0, 8)));
  } catch {
    // 브라우저 저장소가 없으면 복귀 화면은 마이페이지 기본값을 사용한다.
  }
}

/**
 * 서버가 접근을 허용한 화면의 탐색마다 복귀 기록과 Auth.js 세션을 갱신한다.
 * @returns 화면을 차지하지 않는 세션 활동 컴포넌트.
 */
function ObservePage() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  // 쿠키 갱신으로 서버 화면을 다시 렌더링해도 같은 탐색을 반복하지 않는다.
  const last = useRef<string | null>(null);
  /**
   * 현재 탐색만 처리하고 다른 페이지 요청이 시작되면 늦게 돌아온 결과를 무시한다.
   */
  useEffect(() => {
    const location = pathname + (search ? `?${search}` : "");
    const page = parseInternalPage(location);
    if (last.current === location || !page || !isReturnablePage(page.pathname)) return;
    last.current = location;
    remember(location);
    // Strict Mode에서 효과가 재실행돼도 같은 탐색의 요청 하나만 남긴다.
    void withSessionCookieWrite(() => renewPageSession(location)).then((target) => {
      if (target && last.current === location && window.location.pathname === pathname
        && new URLSearchParams(window.location.search).toString() === search) window.location.replace(target);
    }).catch(() => {
      if (last.current === location && window.location.pathname === pathname
        && new URLSearchParams(window.location.search).toString() === search) window.location.replace(AUTH_ERROR_PATH);
    });
  }, [pathname, search]);
  return null;
}

/**
 * 주소의 검색 조건 추적을 Suspense로 감싸 공통 화면의 렌더링에 영향을 주지 않는다.
 * @returns 접근 검증을 통과한 자리에 배치하는 탐색 추적 컴포넌트.
 */
export function PageActivity() {
  return <Suspense fallback={null}><ObservePage /></Suspense>;
}

/**
 * 비로그인 인증 화면에서 이전 세션의 탭 복귀 기록을 제거한다.
 * @returns 화면을 차지하지 않는 기록 초기화 컴포넌트.
 */
export function ClearPageHistory() {
  useEffect(() => {
    try { sessionStorage.removeItem(historyKey); } catch { /* 저장소가 차단된 경우 제거할 기록이 없다. */ }
  }, []);
  return null;
}

/**
 * 브라우저 탭 기록을 서버에서 검증한 다음 안전한 이전 페이지로 이동한다.
 * @param props.current 현재 접근이 거절된 경로.
 * @param props.business 업무 실행 중 권한을 잃어 복귀 화면에서도 경고를 표시할지 여부.
 * @returns 이동 중 표시할 안내.
 */
export function ReturnToPrevious({ current, business = false }: { current: unknown; business?: boolean }) {
  // 업무 오류는 복귀 화면에서 보인 Sonner 안내가 이동 뒤에도 유지되도록 한다.
  const router = useRouter();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (business) toast.error("이 기능을 실행할 권한이 없습니다.", { id: "g2b-business-forbidden" });
    void resolvePageReturn(readHistory(), current)
      .then((path) => {
        if (business) router.replace(path);
        else window.location.replace(path);
      })
      .catch(() => window.location.replace(AUTH_ERROR_PATH));
  }, [business, current, router]);
  return <p role="status">접근할 수 있는 이전 페이지를 확인하는 중입니다.</p>;
}

/**
 * 공통 인증 오류를 Sonner 토스트로 표시한다.
 * @returns 화면을 차지하지 않는 장애 알림.
 */
export function AuthErrorToast() {
  useEffect(() => {
    // 같은 오류 화면이 다시 렌더링되더라도 알림을 중복 생성하지 않는다.
    toast.error("인증 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.", { id: "g2b-auth-error" });
  }, []);
  return null;
}
