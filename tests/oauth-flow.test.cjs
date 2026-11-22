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
