import type { ReactNode } from "react";
import { AccountNavigation } from "@/features/service-auth/AccountNavigation";
import { PageActivity } from "@/features/service-auth/PageActivity";
import { requirePageAccess } from "@/server/auth/page-guard";
import { AUTH_SUCCESS_PATH } from "@/shared/config/auth";

/**
 * 회원 페이지에 공통 계정 메뉴를 배치하고 각 탐색의 서비스 세션을 갱신한다.
 * @param props.children 보호된 회원 화면.
 * @returns 최신 역할로 확인한 회원의 공통 화면.
 * @throws 요청에서 회원 접근이 거절되면 공통 인증 경로로 이동한다.
 */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const auth = await requirePageAccess(AUTH_SUCCESS_PATH);
  // 공통 보호 정책을 통과한 경우에만 회원 부분과 탐색 추적을 제공한다.
  if (auth?.status !== "authenticated") return null;
  return (
    <>
      <header className="border-b px-4 py-3">
        <div className="mx-auto max-w-6xl">
          <AccountNavigation role={auth.state.role} profile={auth.user} />
        </div>
      </header>
      <PageActivity />
      {children}
    </>
  );
}
