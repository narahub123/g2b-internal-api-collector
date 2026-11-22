import * as oauth from "oauth4webapi";
import type { OAuthIdentity } from "./enrollment";

/** Google에 등록할 서비스 콜백 경로. */
export const GOOGLE_CALLBACK_PATH = "/auth/google/callback";

// 메타데이터를 검색할 Google 발급자를 고정한다.
const issuer = new URL("https://accounts.google.com");

/**
 * 서버 자격과 발급자 메타데이터를 확인하여 Google 요청 구성을 만든다.
 * @returns 공급자 메타데이터, ID 토큰 서명 설정, 서버 전용 비밀값.
 * @throws 자격이 없거나 Google 메타데이터 조회·검증에 실패한 경우.
 */
async function configuration() {
  // 서버 설정에서 Google 클라이언트 식별자를 읽는다.
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  // 코드 교환에 사용할 클라이언트 비밀값을 읽는다.
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  // 자격 설정이 두 가지 모두 있는 경우에만 공급자 요청을 진행한다.
  if (!clientId || !clientSecret) throw new Error("Google OAuth 설정이 필요합니다.");
  // 인가, 토큰, 서명 키 주소를 공급자에게 요청하고 대기 시간을 제한한다.
  const response = await oauth.discoveryRequest(issuer, { signal: AbortSignal.timeout(10_000) });
  // 검색한 메타데이터의 발급자가 지정된 Google 주소인지 확인한다.
  const server = await oauth.processDiscoveryResponse(issuer, response);
  // RS256을 지정한 클라이언트 및 공급자 설정을 반환한다.
  return { server, client: { client_id: clientId, id_token_signed_response_alg: "RS256" }, clientSecret };
}

/**
 * AUTH_URL의 고정 origin을 반환한다. 콜백이나 로그인 주소에 요청 Host를 사용하지 않는다.
 * @throws 설정이 없거나 운영 환경에서 HTTPS origin이 아닌 경우.
 * @returns 프로토콜, 호스트, 포트만 포함하는 서비스 origin.
 */
export function authOrigin(): string {
  // 콜백 주소의 기준을 요청 헤더 대신 서버 설정에서 읽는다.
  const url = new URL(process.env.AUTH_URL ?? "");
  // 운영에서 HTTPS를 적용하고 사용자 정보가 포함된 주소를 거절한다.
  if ((url.protocol !== "https:" && (process.env.NODE_ENV === "production" || url.protocol !== "http:"))
    || url.username || url.password) throw new Error("올바른 AUTH_URL 설정이 필요합니다.");
  // 경로와 쿼리를 제외한 주소만 반환한다.
  return url.origin;
}

/**
 * 최초 요청의 state와 새 nonce·PKCE 검증값으로 Google 리다이렉트 주소를 구성한다.
 * @param state 공통 흐름의 식별자. 독립적으로 호출하면 새 state를 생성한다.
 * @throws 공급자 설정 조회 또는 인증 요청 생성이 실패한 경우.
 * @returns Google 인가 URL과 쿠키에 보관할 일회성 검증값.
 */
export async function startGoogleOAuth(state = oauth.generateRandomState()) {
  // 검증된 인가 주소와 클라이언트 ID를 가져온다.
  const { server, client } = await configuration();
  // ID 토큰을 시작 요청에 연결할 nonce를 만든다.
  const nonce = oauth.generateRandomNonce();
  // 인가 코드 교환에서 제시할 PKCE 원본을 만든다.
  const verifier = oauth.generateRandomCodeVerifier();
  // 검증된 Google 엔드포인트를 리다이렉트 대상으로 사용한다.
  const url = new URL(server.authorization_endpoint);
  // 요청 범위, 콜백과 PKCE 해시를 지정하고 Google 계정 선택을 요청한다.
  url.search = new URLSearchParams({
    response_type: "code", client_id: client.client_id, scope: "openid email profile",
    redirect_uri: new URL(GOOGLE_CALLBACK_PATH, authOrigin()).href, state, nonce,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  // 인가 주소와 콜백에서 필요한 원본 검증값을 반환한다.
  return { url: url.href, state, nonce, verifier };
}

/**
 * 콜백 코드를 PKCE로 교환하고 ID 토큰의 발급자, 대상, 기간, nonce와 서명을 검증한다.
 * Google 토큰은 저장하지 않고 식별자와 Google이 검증한 이메일만 사용자 등록 자료로 반환한다.
 * @throws 콜백 위조, 코드 재사용, 토큰 검증 실패 또는 공급자 요청 실패 시.
 * @param code state를 확인한 콜백의 일회성 인가 코드.
 * @param flow 최초 요청의 state, nonce와 PKCE 원본.
 * @returns 계정 확인용 OAuth 식별자와 신규 등록에 사용할 검증 프로필.
 */
export async function completeGoogleOAuth(
  code: string, flow: { state: string; nonce: string; verifier: string },
): Promise<OAuthIdentity> {
  // 코드 교환에 사용할 Google 설정을 확인한다.
  const { server, client, clientSecret } = await configuration();
  // 검증된 콜백 코드를 라이브러리가 처리할 인가 응답으로 구성한다.
  const parameters = oauth.validateAuthResponse(server, client,
    new URLSearchParams({ code, state: flow.state }), flow.state);
  // 등록 콜백 주소, 클라이언트 자격과 PKCE 원본으로 코드를 교환한다.
  const response = await oauth.authorizationCodeGrantRequest(
    server, client, oauth.ClientSecretPost(clientSecret), parameters,
    new URL(GOOGLE_CALLBACK_PATH, authOrigin()).href, flow.verifier, { signal: AbortSignal.timeout(10_000) },
  );
  // 발급자, 대상, 만료와 nonce가 일치하는 ID 토큰을 요구한다.
  const tokens = await oauth.processAuthorizationCodeResponse(server, client, response, {
    expectedNonce: flow.nonce, requireIdToken: true,
  });
  // Google의 공개 키로 ID 토큰 서명을 확인한다.
  await oauth.validateApplicationLevelSignature(server, response, { signal: AbortSignal.timeout(10_000) });
  // 검증된 토큰에서 프로필 정보를 읽는다.
  const claims = oauth.getValidatedIdTokenClaims(tokens);
  // 공급자 고유 ID가 없으면 사용자 확인을 중단한다.
  if (!claims?.sub) throw new Error("Google 사용자 식별자가 없습니다.");
  // OAuth 토큰을 제외하고 서비스에서 사용할 프로필로 변환한다.
  return {
    // 공급자 이름을 OAuth 연결 키 첫 부분으로 사용한다.
    provider: "google",
    // Google 고유 ID를 연결 키 두 번째 부분으로 사용한다.
    providerUserId: claims.sub,
    // 확인된 이메일만 가입 시 통합 후보 확인에 사용한다.
    email: claims.email_verified === true && typeof claims.email === "string" ? claims.email.trim() || null : null,
    // 표시 이름이 없으면 가입 분기에서 누락을 판단할 수 있게 한다.
    nickname: typeof claims.name === "string" ? claims.name.trim() || null : null,
    // HTTPS 이미지 주소만 기본 프로필에 포함한다.
    image: typeof claims.picture === "string" && claims.picture.startsWith("https://") ? claims.picture : null,
  };
}
