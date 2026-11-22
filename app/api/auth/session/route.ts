import { verifyCurrentUser } from "@/server/auth/current-user";
import { renewSession } from "@/server/auth/session";
import {
  AUTH_ERROR_PATH, AUTH_RETURN_PATH, canAccessPage, isReturnablePage, parseInternalPage,
} from "@/shared/config/page-access";

/**
 * 검증 결과와 이동 주소를 캐시에 보관하지 않는 갱신 응답으로 반환한다.
 * @param status 상태를 설명하는 HTTP 상태 코드.
 * @param destination 갱신을 허용하지 않을 때 브라우저가 이동할 서비스 주소.
 * @returns 세션을 다시 렌더링할 업무 데이터 없이 갱신 결과만 전달하는 응답.
 */
function result(status: number, destination: string | null = null) {
  return Response.json({ destination }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * 현재 역할이 페이지 접근을 허용할 때만 Auth.js의 기본 세션 갱신을 수행한다.
 * @param request 같은 서비스에서 열린 페이지 주소를 담은 갱신 요청.
 * @returns 쿠키 갱신 여부 또는 로그인·권한·오류 처리에 필요한 이동 주소.
 */
export async function POST(request: Request) {
  try {
    // 다른 사이트에서 현재 브라우저의 쿠키 만료 시간을 연장할 수 없게 한다.
    const origin = new URL(process.env.AUTH_URL || request.url).origin;
    if (request.headers.get("origin") !== origin) return result(403);
    // 입력 경로는 화면 권한을 판단하는 용도로만 사용하고 사용자 ID나 역할은 받지 않는다.
    const page = parseInternalPage(await request.json().catch(() => null));
    if (!page || !isReturnablePage(page.pathname)) return result(400);
    const auth = await verifyCurrentUser();
    if (auth.status === "unauthenticated") return result(401, "/login");
    if (auth.status === "error") return result(503, AUTH_ERROR_PATH);
    if (!canAccessPage(page.pathname, auth.state.role)) {
      return result(403, `${AUTH_RETURN_PATH}?${new URLSearchParams({ from: page.pathname })}`);
    }
    // Route Handler에서 응답 쿠키만 갱신해 기존 업무 페이지의 데이터를 다시 렌더링하지 않는다.
    await renewSession(async () => auth);
    return result(200);
  } catch (error) {
    console.error("[페이지 세션 갱신]", error instanceof Error ? error.name : "UnknownError");
    return result(503, AUTH_ERROR_PATH);
  }
}
