const assert = require("node:assert/strict");
const { test } = require("node:test");
const { encode } = require("next-auth/jwt");
require("../scripts/register-project-typescript.cjs");

// 하나의 브라우저에서 각 탭이 받은 요청 식별자와 공통 쿠키 키를 사용한다.
const first = "a".repeat(43);
const second = "b".repeat(43);
const secret = "local-test-key";
const signup = {
  provider: "google", purpose: "signup", stage: "pending", state: first,
  nonce: "n".repeat(43), verifier: "v".repeat(43), expiresAt: Math.floor(Date.now() / 1000) + 120,
  consent: [{ id: "terms", version: "1", agreed: true }],
};

/** 잘못된 토큰, 만료된 토큰과 복호화 후 구조가 유효하지 않은 토큰을 검증한다. */
test("단기 상태의 만료와 구조, 식별자 및 인증 단계를 검증한다", async () => {
  const { oauthCookieName, decodeOAuthFlow } = require("../src/server/auth/oauth-state");
  const sign = (flow, maxAge = 60, id = first) => encode({ token: { flow }, secret, salt: oauthCookieName(id), maxAge });
  assert.deepEqual(await decodeOAuthFlow(await sign(signup), secret, first), signup);
  assert.equal(await decodeOAuthFlow(await sign(signup, -1), secret, first), undefined);
  for (const flow of [
    { ...signup, expiresAt: Math.floor(Date.now() / 1000) },
    { ...signup, stage: "unknown" }, { ...signup, stage: "ready" },
    { ...signup, code: "unexpected" }, { ...signup, verifier: false },
    { ...signup, provider: "unknown" }, { ...signup, purpose: "unknown" },
    { ...signup, consent: [{ id: "terms", version: "1", agreed: "true" }] },
    { ...signup, state: second }, null,
  ]) {
    assert.equal(await decodeOAuthFlow(await sign(flow), secret, first), undefined);
  }
  assert.equal(await decodeOAuthFlow(await sign(signup), secret, second), undefined);
  assert.equal(await decodeOAuthFlow("invalid-token", secret, first), undefined);
});

/** 추가 인증 취소·실패가 최초 선택 상태를 보존하며 두 OAuth 요청의 키를 혼동하지 않는지 확인한다. */
test("추가 인증 콜백은 검증된 대상과 별도 흐름 키를 유지한다", async () => {
  const { oauthCookieName, decodeOAuthFlow, resolveOAuthCallback } = require("../src/server/auth/oauth-state");
  // 최초 인증 결과는 선택 쿠키에만 보관하고 추가 인증에는 대상과 부모 키만 넣는다.
  const parent = { ...signup, stage: "link-choice", identity: {
    provider: "google", providerUserId: "unlinked", email: "same@example.com", nickname: null, image: null,
  } };
  delete parent.nonce;
  delete parent.verifier;
  const child = { ...signup, state: second, consent: [], linkAttempt: { parent: first, targetId: "existing" } };
  // 실제 암호화 규칙을 적용해 부모와 자식을 각각 확인한다.
  const signed = (flow) => encode({ token: { flow }, secret, salt: oauthCookieName(flow.state), maxAge: 60 });
  assert.deepEqual(await decodeOAuthFlow(await signed(parent), secret, first), parent);
  assert.deepEqual(await decodeOAuthFlow(await signed(child), secret, second), child);
  assert.equal(await decodeOAuthFlow(await signed({ ...child, purpose: "login" }), secret, second), undefined);
  assert.equal(await decodeOAuthFlow(await signed({ ...child, linkAttempt: { parent: second, targetId: "existing" } }), secret, second), undefined);
  const callback = (input) => resolveOAuthCallback(child, "google", new URLSearchParams({ state: second, ...input }));
  assert.equal(callback({ error: "access_denied" }).location, "/auth/link-account?flow=" + first + "&notice=cancelled");
  assert.equal(callback({ error: "server_error" }).location, "/auth/link-account?flow=" + first + "&notice=failed");
  assert.deepEqual(callback({ code: "proof-code" }).flow.linkAttempt, child.linkAttempt);
  // 발급자가 포함된 콜백을 코드 교환 대기 상태로 전환한다.
  const withIssuer = callback({ code: "proof-code", iss: "https://accounts.google.com" }).flow;
  // 상태를 암호화했다가 읽어도 공급자가 보낸 발급자 원본이 유지돼야 한다.
  assert.equal((await decodeOAuthFlow(await signed(withIssuer), secret, second)).responseIssuer, "https://accounts.google.com");
  // 정상 발급자에 다른 값을 추가해 발급자가 중복된 콜백을 구성한다.
  const duplicateIssuer = new URLSearchParams({ state: second, code: "proof-code", iss: "https://accounts.google.com" });
  duplicateIssuer.append("iss", "https://other.example");
  // 발급자 중복 시 코드 교환을 막고 재시도용 초안만 반환해야 한다.
  assert.equal(resolveOAuthCallback(child, "google", duplicateIssuer).flow.stage, "draft");
  assert.equal(callback({ error: "access_denied" }).flow.linkAttempt, undefined);
  assert.equal(resolveOAuthCallback(parent, "google", new URLSearchParams({ state: first, code: "proof-code" })).flow, undefined);
});

/** 같은 쿠키 저장 공간에서 탭별 콜백과 중복 요청이 다른 흐름에 영향을 주지 않는지 확인한다. */
test("탭별 콜백이 독립적으로 진행되며 이미 받은 콜백은 완료 상태를 바꾸지 않는다", async () => {
  const { oauthCookieName, decodeOAuthFlow, resolveOAuthCallback } = require("../src/server/auth/oauth-state");
  const login = { ...signup, state: second, purpose: "login", consent: [] };
  const jar = new Map();
  async function save(flow) {
    const salt = oauthCookieName(flow.state);
    jar.set(salt, await encode({ token: { flow }, secret, salt, maxAge: 120 }));
  }
  async function callback(id, query) {
    const flow = await decodeOAuthFlow(jar.get(oauthCookieName(id)), secret, id);
    const result = resolveOAuthCallback(flow, "google", new URLSearchParams(query));
    if (result.flow) await save(result.flow);
    return result.location;
  }
  await save(signup);
  await save(login);
  assert.notEqual(oauthCookieName(first), oauthCookieName(second));
  assert.equal(await callback(first, { state: second, code: "wrong" }), "/signup?notice=failed");
  // 두 탭의 콜백이 동시에 도착해도 한쪽은 취소되고 다른 쪽은 완료 대기 상태를 유지한다.
  assert.deepEqual(await Promise.all([
    callback(first, { state: first, code: "first-code" }),
    callback(second, { state: second, error: "access_denied" }),
  ]), ["/auth/complete?flow=" + first, "/login?notice=cancelled&flow=" + second]);
  assert.equal(await callback(first, { state: first, code: "replacement" }), "/auth/complete?flow=" + first);
  const ready = await decodeOAuthFlow(jar.get(oauthCookieName(first)), secret, first);
  assert.equal(ready.code, "first-code");
  assert.equal(ready.expiresAt, signup.expiresAt);
  assert.equal(await callback(second, { state: second, code: "late" }), "/login?notice=failed");
  assert.equal(await callback(first, { state: first, code: "first-code" }), "/auth/complete?flow=" + first);
  assert.equal(resolveOAuthCallback(signup, "other", new URLSearchParams({ state: first, code: "wrong" })).flow, undefined);
  assert.equal(resolveOAuthCallback(signup, "google", new URLSearchParams("state=" + first + "&state=" + second + "&code=x")).flow, undefined);
});

/** 마이페이지 인증은 기존 가입·로그인 흐름과 분리되고 만료된 연결 요청은 소비하지 않는다. */
test("계정 추가 콜백이 로그인 연결을 보존하고 취소와 재요청을 구분한다", async () => {
  const { oauthCookieName, decodeOAuthFlow, resolveOAuthCallback } = require("../src/server/auth/oauth-state");
  // 별도 공급자 요청을 시작한 내부 계정과 연결 세대를 암호화한다.
  const actor = { userId: "member", provider: "google", providerUserId: "original", linkGeneration: "generation" };
  const pending = { ...signup, purpose: "account-add", consent: [], accountActor: actor };
  /**
   * 테스트 입력을 정상 단기 쿠키와 동일한 방식으로 암호화해 읽는다.
   * @param {object} flow 검증할 OAuth 상태.
   * @returns 복호화 및 구조 검증을 통과한 상태.
   */
  async function read(flow) {
    const token = await encode({ token: { flow }, secret, salt: oauthCookieName(first), maxAge: 60 });
    return decodeOAuthFlow(token, secret, first);
  }
  assert.deepEqual(await read(pending), pending);
  assert.equal(await read({ ...pending, expiresAt: 1 }), undefined);
  assert.equal(await read({ ...pending, accountActor: undefined }), undefined);
  assert.equal(await read({ ...pending, purpose: "login" }), undefined);
  assert.equal(await read({ ...pending, linkAttempt: { parent: second, targetId: actor.userId } }), undefined);
  // 기존 로그인 완료 경로와 다른 경로에만 계정 추가를 넘긴다.
  const ready = resolveOAuthCallback(pending, "google", new URLSearchParams({ state: first, code: "original-code" }));
  assert.equal(ready.location, "/mypage/account-complete?flow=" + first);
  assert.deepEqual((await read(ready.flow)).accountActor, actor);
  assert.deepEqual(resolveOAuthCallback(ready.flow, "google", new URLSearchParams({ state: first, code: "replay" })),
    { location: ready.location });
  assert.equal(ready.flow.code, "original-code");
  // 취소하면 복원 가능한 흐름 없이 해당 계정 추가 쿠키 삭제를 요청한다.
  assert.deepEqual(resolveOAuthCallback(pending, "google", new URLSearchParams({ state: first, error: "access_denied" })),
    { location: "/mypage/user?account=cancelled", clear: true });
});
