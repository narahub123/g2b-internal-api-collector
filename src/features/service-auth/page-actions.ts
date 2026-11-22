"use server";

import { redirect } from "next/navigation";
import { AUTH_ERROR_PATH, findReturnDestination } from "@/shared/config/page-access";
import { verifyCurrentUser } from "@/server/auth/current-user";
import { endSession } from "@/server/auth/session";

/**
 * 브라우저의 탭 기록을 최신 역할과 대조해 접근할 수 있는 이전 페이지를 정한다.
 * @param candidates 탭에 최근 정상 표시된 내부 페이지의 후보.
 * @param current 접근이 거절된 페이지 경로.
 * @returns 권한이 있는 이전 페이지, 마이페이지 또는 공통 인증 상태에 해당하는 경로.
 */
export async function resolvePageReturn(candidates: unknown, current: unknown): Promise<string> {
  const auth = await verifyCurrentUser();
  if (auth.status === "unauthenticated") return "/login";
  if (auth.status === "error") return AUTH_ERROR_PATH;
  return findReturnDestination(candidates, current, auth.state.role);
}

/**
 * 현재 브라우저의 서비스 쿠키를 제거한다. 사용자 저장소와 OAuth 제공자 상태는 그대로 유지된다.
 * @throws 로그인 또는 공통 인증 오류 화면으로 이동하는 Next.js 신호.
 */
export async function logout(): Promise<void> {
  try {
    await endSession();
  } catch (error) {
    console.error("[로그아웃]", error instanceof Error ? error.name : "UnknownError");
    redirect(AUTH_ERROR_PATH);
  }
  redirect("/login");
}
