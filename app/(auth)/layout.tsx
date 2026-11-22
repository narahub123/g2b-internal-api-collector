import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { verifyCurrentUser } from "@/server/auth/current-user";
import { AUTH_SUCCESS_PATH } from "@/shared/config/auth";

// 쿠키 검증 결과를 요청마다 확인하므로 인증 화면을 정적으로 만들지 않는다.
export const dynamic = "force-dynamic";

/**
 * 로그인 상태를 최신 사용자 저장소로 확인한 뒤 비로그인 사용자에게만 인증 화면을 제공한다.
 * @param props 인증 화면의 본문을 받는 레이아웃 속성.
 * @param props.children 로그인·가입·완료 페이지가 제공하는 본문.
 * @returns 비로그인 사용자에게 인증 화면을 제공하고 시스템 오류 시 장애 안내를 표시한다.
 * @throws 로그인된 사용자는 Next.js 이동 신호로 마이페이지에 보낸다.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  // 쿠키에 해당하는 유효한 사용자 상태를 확인한다.
  const auth = await verifyCurrentUser();
  // 로그인 상태이면 인증 화면을 다시 표시하지 않는다.
  if (auth.status === "authenticated") redirect(AUTH_SUCCESS_PATH);
  // 인증 화면의 공통 레이아웃을 적용하고, 검증 장애에서는 실행할 폼을 숨긴다.
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-lg content-center gap-4 px-6 py-10">
      {/* 인증 검증이 끝나지 않으면 본문 대신 안전한 오류 안내를 표시한다. */}
      {auth.status === "error"
        ? <p role="alert">인증 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.</p>
        : children}
    </main>
  );
}
