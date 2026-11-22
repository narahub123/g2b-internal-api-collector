import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_SUCCESS_PATH } from "@/shared/config/auth";
import { AUTH_ERROR_PATH, AUTH_RETURN_PATH, PAGE_PATH_HEADER, canAccessPage, pageAccessFor } from "@/shared/config/page-access";
import { verifyCurrentUser } from "./current-user";

/**
 * 보호 데이터가 렌더링되기 전에 최신 DB 상태로 서비스 페이지 접근을 검증한다.
 * @param path Proxy 헤더가 없는 렌더링에서 페이지 진입점이 사용하는 기본 정책 경로.
 * @returns 동일 서버 요청에서 공유되는 인증 결과. 명시적 공개 페이지에는 결과가 없다.
 * @throws 미인증, 권한 부족 또는 장애에 해당하는 내부 페이지로 이동한다.
 */
export async function requirePageAccess(path: string) {
  // 페이지 경로는 Proxy에서 클라이언트 값을 제거하고 실제 요청으로 설정한다.
  const current = (await headers()).get(PAGE_PATH_HEADER) ?? path;
  const policy = pageAccessFor(current);
  if (policy === "public") return;
  const auth = await verifyCurrentUser();
  if (auth.status === "error") redirect(AUTH_ERROR_PATH);
  const role = auth.status === "authenticated" ? auth.state.role : null;
  if (canAccessPage(current, role)) return auth;
  if (!role) redirect("/login");
  if (policy === "guest") redirect(AUTH_SUCCESS_PATH);

  // 접근을 거절한 페이지로 복귀하지 않도록 실제 경로를 전달한다.
  const query = new URLSearchParams({ from: current });
  redirect(`${AUTH_RETURN_PATH}?${query}`);
}

/**
 * 데이터 렌더러의 props를 유지하면서 실제 페이지 진입 시 공통 가드를 먼저 실행한다.
 * @param path 페이지 분류에 사용하는 기본 정책 경로.
 * @param Page 인증 성공 후 렌더링할 서버 페이지.
 * @returns Next.js가 페이지 진입점으로 사용할 컴포넌트.
 */
export function withPageAccess<Props extends object>(path: string, Page: (props: Props) => ReactNode | Promise<ReactNode>) {
  /**
   * 실제 화면이 업무 조회를 시작하기 전에 최신 사용자에게 화면 접근을 허용하는지 판단한다.
   * @param props Next.js가 전달하는 경로 매개변수와 검색 조건.
   * @returns 보호된 페이지 렌더러.
   * @throws 접근할 수 없으면 공통 이동 신호를 보낸다.
   */
  return async function ProtectedPage(props: Props) {
    await requirePageAccess(path);
    return <Page {...props} />;
  };
}
