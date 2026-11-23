import type { ReactNode } from "react";
import { ClearPageHistory } from "@/features/service-auth/PageActivity";
import { requirePageAccess } from "@/server/auth/page-guard";
import { ThemeSelector } from "@/shared/ui/theme-selector";
import { ServiceMain } from "@/shared/ui/ServiceMain";

// 쿠키 검증 결과를 요청마다 확인하므로 인증 화면을 정적으로 만들지 않는다.
export const dynamic = "force-dynamic";

/**
 * 로그인 상태를 확인한 뒤 비로그인 사용자에게 테마 메뉴와 인증 화면을 제공한다.
 * @param props 인증 화면의 본문을 받는 레이아웃 속성.
 * @param props.children 로그인·가입·완료 페이지가 제공하는 본문.
 * @returns 공통 비로그인 인증 화면.
 * @throws 로그인 사용자는 마이페이지로, 검증 장애는 공통 오류 화면으로 이동한다.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  // 쿠키에 해당하는 유효한 사용자 상태를 확인한다.
  await requirePageAccess("/login");
  // 비로그인 상태를 확인한 뒤 이전 로그인에서 남긴 탭 복귀 기록만 정리한다.
   return (
     <>
       <ClearPageHistory />

       {/* 공통 헤더와 동일한 위치 및 스타일 */}
       <header className="px-4 py-2">
         <div className="mx-auto flex w-full min-w-0 max-w-5xl items-center justify-end">
           <ThemeSelector />
         </div>
       </header>

       {/* 일반 페이지와 동일한 본문 레이아웃 */}
       <ServiceMain>
         <div className="grid gap-6">{children}</div>
       </ServiceMain>
     </>
   );
}
