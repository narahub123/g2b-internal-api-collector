import type { ReactNode } from 'react';
import { cookies, headers } from "next/headers";
import { requirePageAccess } from "@/server/auth/page-guard";
import { PAGE_PATH_HEADER } from "@/shared/config/page-access";
import { parseTheme, THEME_COOKIE } from "@/shared/lib/theme";
import { Toaster } from "@/shared/ui/sonner";
import { ThemeProvider } from "@/shared/ui/theme-provider";
import { QueryProvider } from './query-provider';
import './globals.css';

/**
 * 초기 진입 시 공통 접근 정책을 적용하고 요청의 테마를 확인해 업무 화면과 알림에 공유한다.
 * @param props.children 현재 App Router 화면.
 * @returns 전역 React Query 및 Sonner 컨테이너가 포함된 문서.
 * @throws 요청에서 허용되지 않은 페이지는 공통 인증 경로로 이동한다.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  // Proxy가 지정한 실제 경로로 명시 정책이 없는 페이지에도 로그인 필수를 적용한다.
  const pathname = (await headers()).get(PAGE_PATH_HEADER);
  if (pathname) await requirePageAccess(pathname);
  // 브라우저가 첫 화면부터 선택한 테마를 표시하도록 요청 쿠키를 확인한다.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  // 초기 테마를 문서 속성에 적용하고 이후 변경을 화면과 알림에 공유한다.
  return (
    <html lang="ko" data-theme={theme}>
      <body>
        <ThemeProvider initialTheme={theme}>
          {/* 업무 화면은 쿼리 상태를 공유하고 알림은 모든 화면에서 표시된다. */}
          <QueryProvider>{children}</QueryProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
