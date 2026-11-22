import { readOAuthFlow, restoreOAuthDraft, writeOAuthFlow } from "@/server/auth/oauth-flow";

/**
 * OAuth 결과를 내부 페이지로 보내고 콜백 주소가 캐시나 다음 요청의 참조 주소에 남지 않도록 한다.
 * @param location 완료 또는 안내를 표시할 서비스 내부 경로.
 * @returns 본문이 없는 캐시 금지 303 응답.
 */
function go(location: string) {
  // 브라우저가 지정된 내부 페이지로 후속 GET 요청을 보내도록 구성한다.
  return new Response(null, { status: 303, headers: {
    Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  } });
}

/**
 * 이 브라우저에서 시작한 Google 콜백만 완료 화면으로 보낸다.
 * 취소·실패는 동의 초안으로 되돌리고, 성공 코드 교환과 저장은 Server Action에서 수행한다.
 * @param request Google의 state와 인가 코드 또는 오류를 담은 콜백 요청.
 * @returns 완료 화면, 취소·실패 안내 또는 인증 서비스 장애 안내로 이동하는 응답.
 */
export async function GET(request: Request) {
  // 쿠키 복호화와 응답 쓰기 실패를 공통 장애 안내로 처리한다.
  try {
    // 최초 요청의 목적과 검증값을 브라우저 쿠키에서 읽는다.
    const flow = await readOAuthFlow();
    // 대기 중인 요청이 없으면 어떤 인가 코드도 받지 않는다.
    if (!flow || flow.stage !== "pending") return go("/login?notice=failed");
    // 최초 요청 목적에 따른 재시도 화면을 선택한다.
    const path = flow.purpose === "signup" ? "/signup" : "/login";
    // 인가 결과를 나타내는 콜백 쿼리를 분리한다.
    const params = new URL(request.url).searchParams;
    // state 값의 일치뿐 아니라 중복 여부도 검사하도록 모두 읽는다.
    const state = params.getAll("state");
    // 다른 탭의 오래된 콜백이 현재 유효한 요청을 덮어쓰지 않게 한다.
    if (state.length !== 1 || state[0] !== flow.state) return go(`${path}?notice=failed`);
    // 인가 코드의 중복 여부를 판단하도록 모든 값을 읽는다.
    const codes = params.getAll("code");
    // Google 오류 중 사용자가 직접 취소한 경우를 구분한다.
    const error = params.get("error");
    // 공급자 오류나 누락·중복·과도한 길이의 코드는 교환하지 않는다.
    if (params.has("error") || codes.length !== 1 || !codes[0] || codes[0].length > 1000) {
      // 재시도할 때 체크 상태를 복원하도록 초안만 남긴다.
      await restoreOAuthDraft(flow);
      // 사용자 취소와 그 밖의 실패를 각각의 안내 코드로 전달한다.
      return go(`${path}?notice=${error === "access_denied" ? "cancelled" : "failed"}`);
    }
    // 콜백 검증을 통과한 코드를 단기 암호화 쿠키로 넘긴다.
    await writeOAuthFlow({ ...flow, stage: "ready", code: codes[0] });
    // 브라우저가 후속 Server Action을 실행하는 완료 페이지로 이동한다.
    return go("/auth/complete");
  // 잘못된 설정 또는 쿠키 쓰기 장애는 사용자에게 내부 상세를 숨긴다.
  } catch (error) {
    // 콜백 입력이나 오류 객체 없이 예외 유형만 기록한다.
    console.error("[Google 콜백]", error instanceof Error ? error.name : "UnknownError");
    // 새 계정이나 세션 없이 로그인 장애 안내로 이동한다.
    return go("/login?notice=unavailable");
  }
}
