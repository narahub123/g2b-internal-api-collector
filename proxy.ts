import { NextResponse, type NextRequest } from "next/server";
import { AUTH_ERROR_PATH, PAGE_PATH_HEADER, pageAccessFor } from "@/shared/config/page-access";
import { readSessionCookie } from "@/server/auth/session-cookie";

/**
 * 페이지 요청에서 쿠키를 읽어 비로그인 접근을 먼저 분기하고 최종 권한 판단은 서버 페이지에 맡긴다.
 * @param request Next.js가 전달하는 페이지 요청.
 * @returns 초기 로그인·장애 응답 또는 실제 페이지 경로를 전달하는 응답.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const policy = pageAccessFor(pathname);
  // POST는 Server Action 자체에서 결과를 처리하도록 페이지 이동 규칙을 적용하지 않는다.
  if ((request.method === "GET" || request.method === "HEAD") && (policy === "member" || policy === "admin")) {
    try {
      if (!await readSessionCookie(request.headers)) return NextResponse.redirect(new URL("/login", request.url));
    } catch (error) {
      console.error("[페이지 세션 검증]", error instanceof Error ? error.name : "UnknownError");
      return NextResponse.redirect(new URL(AUTH_ERROR_PATH, request.url));
    }
  }
  // 클라이언트가 보낸 경로 값은 사용하지 않고 실제 요청 경로로 교체한다.
  const forwarded = new Headers(request.headers);
  forwarded.set(PAGE_PATH_HEADER, pathname);
  return NextResponse.next({ request: { headers: forwarded } });
}

/** API 권한과 자동 실행 규칙은 각 API 진입점에서 처리한다. */
export const config = { matcher: ["/((?!api(?:/|$)|_next(?:/|$)|favicon.ico$|robots.txt$|sitemap.xml$).*)"] };
