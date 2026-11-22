import type { ReactNode } from 'react';
import { headers } from "next/headers";
import { requirePageAccess } from "@/server/auth/page-guard";
import { PAGE_PATH_HEADER } from "@/shared/config/page-access";
import { Toaster } from "@/shared/ui/sonner";
import { QueryProvider } from './query-provider';
import './globals.css';

/**
 * 초기 진입 시 공통 정책을 적용하고 업무 화면과 오류 알림을 서비스 루트에 배치한다.
 * @param props.children 현재 App Router 화면.
 * @returns 전역 React Query 및 Sonner 컨테이너가 포함된 문서.
 * @throws 요청에서 허용되지 않은 페이지는 공통 인증 경로로 이동한다.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  // Proxy가 지정한 실제 경로로 명시 정책이 없는 페이지에도 로그인 필수를 적용한다.
  const pathname = (await headers()).get(PAGE_PATH_HEADER);
  if (pathname) await requirePageAccess(pathname);
  return (
    <html lang="ko">
      <body>
        <QueryProvider>{children}</QueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
