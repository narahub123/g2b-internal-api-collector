import { cookies } from "next/headers";
import { decode, encode } from "next-auth/jwt";
import type { SignupConsent } from "./enrollment";

/** 단기 OAuth 상태의 목적에 따라 콜백 및 오류 복귀 화면을 구분한다. */
export type AuthPurpose = "login" | "signup";

// 초안에는 가입 또는 로그인 목적과 재시도 시 보존할 동의 선택을 담는다.
type Draft = { purpose: AuthPurpose; consent: SignupConsent[] };

/** 브라우저 쿠키에 암호화할 요청, 콜백 교환 대기 또는 재시도 상태. */
export type OAuthFlow = Draft & (
  // 인가 요청 정보 없이 동의 선택만 보존하는 상태.
  | { stage: "draft" }
  // 콜백 대기 상태에 state, nonce와 PKCE 검증값을 저장한다.
  | { stage: "pending"; state: string; nonce: string; verifier: string }
  // 코드 교환 대기 상태에 검증값과 일회성 인가 코드를 저장한다.
  | { stage: "ready"; state: string; nonce: string; verifier: string; code: string }
);

// 운영에서 Secure 쿠키와 호스트 범위 제한을 적용한다.
const secure = process.env.NODE_ENV === "production";
// 환경별 OAuth 흐름 쿠키 이름을 암호화 구분값으로도 사용한다.
const name = secure ? "__Host-g2b-oauth-flow" : "g2b-oauth-flow";
// 동의 초안과 인가 자료의 최대 수명을 초 단위로 정한다.
const maxAge = 10 * 60;
// Google에서 돌아온 요청에 쿠키를 보내되 클라이언트 코드의 읽기를 차단한다.
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
 * @throws 쿠키가 있으나 복호화에 필요한 비밀 설정이 없는 경우.
 * @returns 유효한 인증 상태 또는 쿠키가 없거나 검증되지 않은 경우 undefined.
 */
export async function readOAuthFlow(): Promise<OAuthFlow | undefined> {
  // 현재 브라우저의 인증 흐름 쿠키를 읽는다.
  const token = (await cookies()).get(name)?.value;
  // 쿠키가 없으면 키 확인과 복호화를 진행하지 않는다.
  if (!token) return undefined;
  // 서버 설정 오류를 손상·만료 토큰과 구분한다.
  const key = secret();
  try {
    // 서버 비밀과 쿠키 이름으로 토큰의 무결성을 확인해 복호화한다.
    const payload = await decode({ token, secret: key, salt: name });
    // 만료 시각이 지나지 않은 상태만 코드 교환이나 재시도에 사용한다.
    if (payload?.exp > Date.now() / 1000) return payload.flow as OAuthFlow;
  } catch {
    // 검증되지 않은 상태에서는 OAuth 코드 교환을 진행하지 않는다.
  }
}

/**
 * OAuth 상태를 단기 암호화 쿠키로 바꾼다. 브라우저 코드에는 코드와 검증값을 보내지 않는다.
 * @throws 비밀 설정이나 응답 쿠키 설정에 실패한 경우.
 * @param flow 암호화해 응답에 저장할 인증 진행 상태.
 */
export async function writeOAuthFlow(flow: OAuthFlow): Promise<void> {
  // 동의 선택과 검증값을 암호화한다.
  const token = await encode({ token: { flow }, secret: secret(), salt: name, maxAge });
  // 암호화된 상태를 토큰과 동일한 수명의 쿠키로 설정한다.
  (await cookies()).set(name, token, { ...options, maxAge });
}

/**
 * 완료한 OAuth 흐름의 쿠키를 현재 브라우저에서 지운다.
 * @throws 현재 응답에서 쿠키를 설정할 수 없는 경우.
 */
export async function clearOAuthFlow(): Promise<void> {
  // 현재 브라우저가 같은 이름과 범위의 쿠키를 즉시 제거하도록 한다.
  (await cookies()).set(name, "", { ...options, maxAge: 0 });
}

/**
 * 재시도를 위해 목적과 법적 동의만 남기고 기존 코드 및 검증값을 제거한다.
 * @param flow 재시도에 필요한 목적과 동의를 가져올 현재 인증 상태.
 * @throws 초안 토큰 생성이나 쿠키 설정에 실패한 경우.
 */
export async function restoreOAuthDraft({ purpose, consent }: OAuthFlow): Promise<void> {
  // 이전 요청의 검증값과 코드를 제거하고 동의 선택을 다시 기록한다.
  await writeOAuthFlow({ stage: "draft", purpose, consent });
}
