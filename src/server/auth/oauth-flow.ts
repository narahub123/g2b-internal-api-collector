import { cookies } from "next/headers";
import { encode } from "next-auth/jwt";
import { decodeOAuthFlow, isOAuthFlowId, oauthCookieName, toOAuthDraft, type OAuthFlow } from "./oauth-state";

// 운영에서 Secure 쿠키와 호스트 범위 제한을 적용한다.
const secure = process.env.NODE_ENV === "production";
// 공급자에서 돌아온 요청에 쿠키를 보내되 클라이언트 코드의 읽기를 차단한다.
const options = { httpOnly: true, secure, sameSite: "lax", path: "/" } as const;

/**
 * 단기 쿠키 암호화 또는 복호화에 사용할 서버 비밀을 확인한다.
 * @returns 서버의 인증 비밀값.
 * @throws 비밀이 없거나 공백만 설정된 경우.
 */
function secret() {
  // 인증 비밀값을 서버 환경에서 읽는다.
  const value = process.env.AUTH_SECRET;
  // 암호화에 사용할 값이 없으면 흐름을 중단한다.
  if (!value?.trim()) throw new Error("AUTH_SECRET 환경변수가 필요합니다.");
  // 검증된 설정값을 암호화 기능에 전달한다.
  return value;
}

/**
 * 이 브라우저에서 시작한 단기 OAuth 상태를 읽는다. 만료되거나 암호 검증에 실패하면 무시한다.
 * @param state 현재 탭의 콜백, 완료 폼 또는 가입 복귀 주소가 가리키는 흐름 키.
 * @throws 쿠키가 있으나 복호화에 필요한 비밀 설정이 없는 경우.
 * @returns 유효한 인증 상태 또는 쿠키가 없거나 검증되지 않은 경우 undefined.
 */
export async function readOAuthFlow(state: unknown): Promise<OAuthFlow | undefined> {
  // 입력 형식이 정확할 때만 이 요청 전용 쿠키를 읽는다.
  if (!isOAuthFlowId(state)) return undefined;
  const token = (await cookies()).get(oauthCookieName(state))?.value;
  // 쿠키가 없으면 키 확인과 복호화를 진행하지 않는다.
  if (!token) return undefined;
  // 서버 설정 오류는 손상·만료 토큰과 구분하고 구조가 유효한 상태만 반환한다.
  return decodeOAuthFlow(token, secret(), state);
}

/**
 * OAuth 상태를 단기 암호화 쿠키로 바꾼다. 브라우저 코드에는 코드와 검증값을 보내지 않는다.
 * @throws 비밀 설정이나 응답 쿠키 설정에 실패한 경우.
 * @param flow 암호화해 응답에 저장할 인증 진행 상태.
 */
export async function writeOAuthFlow(flow: OAuthFlow): Promise<void> {
  // 현재 흐름의 쿠키와 최초 요청의 남은 수명만 사용한다.
  const name = oauthCookieName(flow.state);
  const maxAge = flow.expiresAt - Math.floor(Date.now() / 1000);
  if (maxAge <= 0) {
    await clearOAuthFlow(flow.state);
    return;
  }
  // 동의 선택과 확인 자료를 암호화하고 다른 탭의 쿠키는 변경하지 않는다.
  const token = await encode({ token: { flow }, secret: secret(), salt: name, maxAge });
  // 암호화된 상태를 토큰과 동일한 수명의 쿠키로 설정한다.
  (await cookies()).set(name, token, { ...options, maxAge });
}

/**
 * 완료한 OAuth 흐름의 쿠키를 현재 브라우저에서 지운다.
 * @param state 제거할 흐름의 확인된 키.
 * @throws 현재 응답에서 쿠키를 설정할 수 없는 경우.
 */
export async function clearOAuthFlow(state: string): Promise<void> {
  // 현재 브라우저가 같은 이름과 범위의 쿠키를 즉시 제거하도록 한다.
  (await cookies()).set(oauthCookieName(state), "", { ...options, maxAge: 0 });
}

/**
 * 재시도를 위해 목적과 법적 동의만 남기고 기존 코드 및 검증값을 제거한다.
 * @param flow 재시도에 필요한 목적과 동의를 가져올 현재 인증 상태.
 * @throws 초안 토큰 생성이나 쿠키 설정에 실패한 경우.
 */
export async function restoreOAuthDraft(flow: OAuthFlow): Promise<void> {
  // 이전 요청의 검증값과 코드를 제거하고 동의 선택을 다시 기록한다.
  await writeOAuthFlow(toOAuthDraft(flow));
}
