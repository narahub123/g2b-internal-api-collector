import type { ReactNode } from "react";
import { AccountNavigation } from "@/features/service-auth/AccountNavigation";
import { PageActivity } from "@/features/service-auth/PageActivity";
import { requirePageAccess } from "@/server/auth/page-guard";
import { AdminSidebar } from "./AdminSidebar";

/**
 * 관리자 헤더와 공통 본문을 배치하고 모든 하위 화면의 본문 폭과 바깥 여백을 적용한다.
 * @param props.children 관리자 업무 화면.
 * @returns 관리 권한이 검증된 사용자의 메뉴 및 본문.
 * @throws 관리자 접근이 거절되면 공통 인증 경로로 이동한다.
 */
export async function AdminLayout({ children }: { children: ReactNode }) {
  // 관리자 메뉴와 탐색 추적도 공통 관리자 권한으로 가린다.
  const auth = await requirePageAccess("/admin");
  if (auth?.status !== "authenticated") return null;
  return (
    <>
      <PageActivity />
      <header className="border-b bg-card px-4 py-2">
        <div className="mx-auto flex w-full min-w-0 max-w-5xl items-center gap-3">
          <AdminSidebar />
          <AccountNavigation role={auth.state.role} profile={auth.user} />
        </div>
      </header>
      <main data-slot="admin-content" className="min-w-0 px-4 py-8 sm:px-6">
        <div className="mx-auto w-full min-w-0 max-w-5xl">{children}</div>
      </main>
    </>
  );
}
