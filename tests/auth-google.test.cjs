// 인가 요청과 검증 결과의 기대값을 비교하는 도구.
const assert = require("node:assert/strict");
// 모의 공급자의 ID 토큰을 서명할 테스트 키를 생성한다.
const { generateKeyPairSync, sign } = require("node:crypto");
// Google 프로토콜 흐름을 독립 실행할 테스트 함수.
const { test } = require("node:test");
// 프로젝트 TypeScript 로직을 테스트에서 그대로 실행한다.
require("../scripts/register-project-typescript.cjs");

/**
 * 서명된 모의 Google 응답으로 콜백, PKCE, nonce와 서명 검증을 확인한다.
 * @param t 환경값 복구와 외부 호출 모의를 등록하는 테스트 컨텍스트.
 */
test("Google OIDC 교환은 콜백 주소, PKCE, nonce 및 ID 토큰 서명을 검증한다", async (t) => {
  // 실제 앱이 호출하는 Google 요청과 코드 교환 함수를 가져온다.
  const { startGoogleOAuth, completeGoogleOAuth } = require("../src/server/auth/google");
  // 모의 메타데이터와 토큰에 사용할 Google 발급자.
  const issuer = "https://accounts.google.com";
  // Google 클라이언트에 등록되었다고 가정할 콜백 URL.
  const callback = "https://service.example.com/auth/google/callback";
  // 검증용 JWT 서명과 공개 키 노출에 사용할 키 쌍.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  // 모의 공개 키 응답에 포함할 RS256 검증 키.
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" };
  /**
   * 토큰 헤더와 클레임을 JWT 부분 문자열로 인코딩한다.
   * @param value 헤더 또는 클레임에 기록할 JSON 값.
   * @returns 패딩을 제거한 Base64 URL 문자열.
   */
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  // 실제 Google 자격을 사용하지 않도록 테스트용 환경값을 지정한다.
  const env = { AUTH_URL: "https://service.example.com", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret" };
  // 각 환경값을 테스트 동안 교체하고 종료 시 복구한다.
  for (const [name, value] of Object.entries(env)) {
    // 다른 작업에 영향이 없도록 사용자 환경의 원래 값을 저장한다.
    const previous = process.env[name];
    // 검증에 필요한 값으로 해당 설정을 교체한다.
    process.env[name] = value;
    /**
     * 테스트가 끝나면 백업 값이 있을 때만 복원하고 없으면 테스트 값을 제거한다.
     */
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  // 인가 요청이 발급한 PKCE 검증값을 토큰 요청과 대조한다.
  let flow;
  // 정상·불일치 검증을 위해 응답 토큰의 nonce를 바꾼다.
  let nonce;
  // 토큰 클레임은 유지한 채 검증할 서명만 깨뜨리는 조건.
  let wrongSignature = false;
  /**
   * 실제 네트워크 접근 없이 메타데이터, 토큰, 공개 키 응답을 모의한다.
   * @param url 공급자 요청 주소.
   * @param options 코드와 PKCE가 포함된 요청 옵션.
   * @returns 해당 Google 엔드포인트의 모의 응답.
   * @throws 테스트에서 지정하지 않은 주소를 호출한 경우.
   */
  t.mock.method(globalThis, "fetch", async (url, options) => {
    // 요청 경로를 기준으로 필요한 공급자 응답을 선택한다.
    switch (new URL(url).pathname) {
      case "/.well-known/openid-configuration":
        // 지정된 발급자 및 인가·토큰·키 엔드포인트를 검색 결과로 반환한다.
        return Response.json({
          issuer, authorization_endpoint: issuer + "/authorize", token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/certs",
        });
      // 토큰 요청은 브라우저의 일회성 인가 코드를 교환하는 경로다.
      case "/token": {
        // 토큰 요청 자료를 비교 가능한 폼 매개변수로 변환한다.
        const body = new URLSearchParams(options.body);
        // 최초 요청의 PKCE 원본이 교환에 전달되었는지 확인한다.
        assert.equal(body.get("code_verifier"), flow.verifier);
        // 토큰 교환에서 최초 요청과 동일한 콜백을 사용해야 한다.
        assert.equal(body.get("redirect_uri"), callback);
        // 검증한 인가 코드만 교환 요청의 입력으로 보내야 한다.
        assert.equal(body.get("code"), "one-time-code");
        // 유효기간 검증을 통과할 기준 시각을 초 단위로 계산한다.
        const now = Math.floor(Date.now() / 1000);
        // 실제 검증에 필요한 클레임과 테스트용 프로필로 JWT 서명 입력을 구성한다.
        const payload = `${encode({ alg: "RS256", kid: "test" })}.${encode({
          iss: issuer, aud: "test-client", sub: "google-user", iat: now, exp: now + 60,
          nonce, email: "test@example.com", email_verified: true, name: "Test",
        })}`;
        // 정상 서명을 생성하거나 실패 시나리오용 무효 서명으로 바꾼다.
        const signature = wrongSignature ? Buffer.alloc(256) : sign("RSA-SHA256", Buffer.from(payload), privateKey);
        // 서명된 ID 토큰과 토큰 엔드포인트에 필요한 응답 필드를 보낸다.
        return Response.json({ token_type: "Bearer", access_token: "unused", id_token: payload + "." + signature.toString("base64url") });
      }
      // 공급자 서명을 검증할 공개 키를 요청하면 테스트 키를 반환한다.
      case "/certs": return Response.json({ keys: [jwk] });
      // 예상하지 못한 네트워크 호출을 테스트 실패로 처리한다.
      default: throw new Error("unexpected OIDC endpoint");
    }
  });
  // 리다이렉트 URL과 초기 요청 검증값을 생성한다.
  flow = await startGoogleOAuth();
  // 구성한 인가 URL의 쿼리를 비교할 수 있게 분리한다.
  const url = new URL(flow.url);
  // Google 인가 요청에 등록한 콜백이 포함되는지 확인한다.
  assert.equal(url.searchParams.get("redirect_uri"), callback);
  // 인증 응답을 최초 요청과 연결할 state를 전달해야 한다.
  assert.equal(url.searchParams.get("state"), flow.state);
  // 인가 요청의 PKCE 해시 방식은 S256이어야 한다.
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  // 토큰과 초기 요청을 연결할 nonce를 제공해야 한다.
  assert.equal(url.searchParams.get("nonce"), flow.nonce);
  // URL에는 PKCE 원본 대신 해시만 포함되어야 한다.
  assert.notEqual(url.searchParams.get("code_challenge"), flow.verifier);
  // 정상 응답을 검증하도록 최초 요청의 nonce를 사용한다.
  nonce = flow.nonce;
  // 정상 서명 응답에서 계정 키와 프로필만 반환하는지 확인한다.
  assert.deepEqual(await completeGoogleOAuth("one-time-code", flow), {
    provider: "google", providerUserId: "google-user", email: "test@example.com", nickname: "Test", image: null,
  });
  // 같은 요청을 가장하는 응답에 잘못된 nonce를 설정한다.
  nonce = "incorrect";
  // 서명이 유효해도 최초 요청과 관계없는 토큰은 거절해야 한다.
  await assert.rejects(completeGoogleOAuth("one-time-code", flow), /nonce/);
  // 서명만 검증하기 위해 nonce를 원래 값으로 되돌린다.
  nonce = flow.nonce;
  // 내용이 정상이어도 서명이 무효한 응답을 준비한다.
  wrongSignature = true;
  // 서명이 유효하지 않으면 사용자 프로필을 반환하지 않아야 한다.
  await assert.rejects(completeGoogleOAuth("one-time-code", flow), /signature/);
});
