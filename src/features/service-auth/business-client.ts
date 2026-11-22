"use client";

import { toast } from "sonner";
import { BUSINESS_AUTH_HEADER, BUSINESS_AUTH_STATUS, BUSINESS_PAGE_HEADER, type BusinessAuthFailure } from "@/shared/model/business-auth";
import { AUTH_RETURN_PATH, parseInternalPage } from "@/shared/config/page-access";
import { withSessionCookieWrite } from "./session-writes";

/**
 * 업무 실행 전에 거절된 이유를 공통 토스트와 페이지 이동으로 처리한다.
 * @param failure 서버 액션 또는 API에서 받은 공통 실패.
 */
export function handleBusinessFailure(failure: BusinessAuthFailure): void {
  if (failure.auth === "unauthenticated") {
    window.location.replace("/login");
    return;
  }
  toast.error(failure.error, { id: `g2b-business-${failure.auth}` });
  // 현재 페이지 권한까지 상실했을 때만 공통 복귀 경로를 사용한다.
  const target = parseInternalPage(failure.destination);
  if (failure.auth === "forbidden" && target?.pathname === AUTH_RETURN_PATH) {
    window.location.replace(target.pathname + target.search);
  }
}

/**
 * 기존 업무 응답을 보존하면서 인증 검증 실패만 공통 방식으로 표시한다.
 * @param input 애플리케이션의 업무 API 주소.
 * @param init 업무 요청에 필요한 메서드, 본문 또는 중단 신호.
 * @returns 호출자가 기존 형식으로 처리할 HTTP 응답.
 * @throws 네트워크 오류 또는 요청 중단을 기존 호출자에 전달한다.
 */
export async function businessFetch(input: string, init?: RequestInit): Promise<Response> {
  // 화면 컨텍스트가 없는 호출에서도 기존 HTTP 동작을 보존한다. API 자체는 같은 서버 가드를 거친다.
  if (typeof window === "undefined") return fetch(input, init);
  const current = window.location.pathname + window.location.search;
  const headers = new Headers(init?.headers);
  headers.set(BUSINESS_PAGE_HEADER, window.location.pathname);
  const response = await withSessionCookieWrite(() => fetch(input, { ...init, headers }));
  const auth = response.headers.get(BUSINESS_AUTH_HEADER);
  if (auth && Object.hasOwn(BUSINESS_AUTH_STATUS, auth)
    && response.status === BUSINESS_AUTH_STATUS[auth as BusinessAuthFailure["auth"]]) {
    const failure = await response.clone().json() as BusinessAuthFailure;
    // 다른 화면의 늦은 요청이 현재 탭의 탐색을 바꾸지 않게 한다.
    if (current === window.location.pathname + window.location.search) handleBusinessFailure(failure);
  }
  return response;
}
