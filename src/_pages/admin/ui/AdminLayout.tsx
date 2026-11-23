import type { ReactNode } from "react";
import { ServiceHeader } from "@/features/service-auth/ServiceHeader";
import { PageActivity } from "@/features/service-auth/PageActivity";
import { requirePageAccess } from "@/server/auth/page-guard";
import { ServiceMain } from "@/shared/ui/ServiceMain";
import { AdminSidebar } from "./AdminSidebar";

/**
 * 관리자 사이드바를 담은 공통 헤더와 본문을 배치하고 모든 하위 화면의 본문 폭과 바깥 여백을 적용한다.
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
      {/* 공통 헤더의 왼쪽에 관리자 사이드바를 배치한다. */}
      <ServiceHeader role={auth.state.role} profile={auth.user} navigation={<AdminSidebar />} />
      {/* 기존 관리자 본문 식별자를 공통 본문에 전달한다. */}
      <ServiceMain slot="admin-content">{children}</ServiceMain>
    </>
  );
}
