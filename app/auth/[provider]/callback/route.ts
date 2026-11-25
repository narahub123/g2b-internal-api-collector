import { clearOAuthFlow, readOAuthFlow, writeOAuthFlow } from "@/server/auth/oauth-flow";
import { resolveOAuthCallback } from "@/server/auth/oauth-state";
import { isOAuthProvider } from "@/shared/config/oauth-providers";

/**
 * 공급자 콜백을 내부 페이지로 보내고 인가 주소가 캐시나 참조 주소로 전달되지 않게 한다.
 * @param location 완료나 오류를 표시할 내부 경로.
 * @returns 본문이 없는 캐시 금지 303 응답.
 */
function go(location: string) {
  // 브라우저가 내부 페이지를 새 요청으로 열도록 한다.
  return new Response(null, { status: 303, headers: {
    Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  } });
}

/**
 * 경로의 공급자와 브라우저의 인증 요청을 대조하고 해당 흐름만 완료 또는 복귀 상태로 바꾼다.
 * @param request 공급자가 보낸 state와 인가 결과가 있는 콜백 요청.
 * @param context 공급자 식별자를 제공하는 Next.js 경로 컨텍스트.
 * @returns 해당 흐름의 완료·재시도 화면 또는 공통 장애 안내로 이동하는 응답.
 */
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    // 콜백 경로에서 브라우저가 선택했던 공급자 식별자를 읽는다.
    const { provider } = await context.params;
    // 공급자 응답의 인가 결과와 연결 키를 주소에서 분리한다.
    const query = new URL(request.url).searchParams;
    const states = query.getAll("state");
    // 등록된 공급자만 처리하고 중복 state가 있는 요청은 쿠키를 읽기 전에 거절한다.
    if (!isOAuthProvider(provider) || states.length !== 1) return go("/login?notice=failed");
    // 공급자가 돌려준 키로 선택한 탭의 상태를 읽어 검증한다.
    const result = resolveOAuthCallback(await readOAuthFlow(states[0]), provider, query);
    // 취소·실패한 계정 추가 요청의 쿠키는 다시 사용하지 않는다.
    if (result.clear) await clearOAuthFlow(states[0]);
    // 상태 전이가 필요한 응답에서만 해당 탭의 쿠키를 갱신한다.
    if (result.flow) await writeOAuthFlow(result.flow);
    // 상태 검증과 쿠키 처리를 마친 뒤 안전한 내부 경로로 이동한다.
    return go(result.location);
  } catch (error) {
    // 인가 코드나 원본 오류 없이 예외 이름만 서버에 기록한다.
    console.error("[OAuth 콜백]", error instanceof Error ? error.name : "UnknownError");
    // 검증을 완료할 수 없으면 코드 교환 대신 인증 장애를 표시한다.
    return go("/login?notice=unavailable");
  }
}
