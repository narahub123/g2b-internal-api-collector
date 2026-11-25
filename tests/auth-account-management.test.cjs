const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");

/** 다른 이메일 연결, 소유권 충돌과 세션 세대의 차단을 실제 DB에서 검증한다. */
test("OAuth 연결 변경은 소유자와 현재 세대를 검증하고 해제된 세대를 복구하지 않는다", async () => {
  // 동일 공급자의 서로 다른 세 계정과 독립 사용자 두 명을 준비한다.
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { resolveEnrollment } = require("../src/server/auth/enrollment");
  const { openAuthRepository } = require("../src/server/auth/repository");
  const { addLinkedAccount } = require("../src/server/auth/linked-accounts");
  const client = createClient({ url: "file::memory:" });
  const database = new G2bDatabase(client);
  const repository = openAuthRepository(database);
  const first = { provider: "google", providerUserId: "first", email: "first@example.test", nickname: "Original", image: null };
  const second = { ...first, providerUserId: "second", email: "second@example.test", nickname: "Changed" };
  const third = { ...first, providerUserId: "third", email: "third@example.test" };
  try {
    // 가입 상태와 동의 이력을 갖춘 사용자를 실제 등록한다.
    await migrateG2bDatabase(client);
    const { user } = await resolveEnrollment(database, "signup", first, [{ id: "terms", version: "1", agreed: true }]);
    const { user: other } = await resolveEnrollment(database, "signup", third, []);
    const current = user.oauthAccount;
    // 같은 연결의 동시 이메일 변경은 세션 발급을 막지 않는다.
    await repository.confirmOAuthEmail(user, "updated@example.test");
    const observed = await repository.confirmOAuthEmail(user, "concurrent@example.test");
    assert.equal(observed.oauthAccount.email, "concurrent@example.test");
    assert.equal(await addLinkedAccount(database, user.id, current, second), "added");
    assert.equal(await addLinkedAccount(database, user.id, current, second), "already-linked");
    assert.equal(await addLinkedAccount(database, user.id, current, third), "conflict");
    const { user: secondary } = await resolveEnrollment(database, "login", second, []);
    assert.equal(secondary.id, user.id);
    assert.equal(secondary.nickname, "Original");
    assert.equal(secondary.oauthAccount.email, second.email);
    assert.equal((await repository.listLinkedAccounts(user.id)).length, 2);
    // 현재 계정, 타인 계정, 이전 세대의 요청은 해제할 수 없다.
    assert.equal(await repository.unlinkAccount(user.id, current, current.linkGeneration), false);
    assert.equal(await repository.unlinkAccount(user.id, current, other.oauthAccount.linkGeneration), false);
    assert.equal(await repository.unlinkAccount(user.id, { ...current, linkGeneration: "stale" }, secondary.oauthAccount.linkGeneration), false);
    // 두 기기의 해제 요청이 경쟁해도 반드시 한 개의 연결이 남는다.
    const outcomes = await Promise.all([
      repository.unlinkAccount(user.id, current, secondary.oauthAccount.linkGeneration),
      repository.unlinkAccount(user.id, secondary.oauthAccount, current.linkGeneration),
    ]);
    assert.equal(outcomes.filter(Boolean).length, 1);
    const survivor = outcomes[0] ? current : secondary.oauthAccount;
    const revoked = outcomes[0] ? secondary.oauthAccount : current;
    assert.equal(await repository.findUserState(user.id, revoked), undefined);
    assert.ok(await repository.findUserState(user.id, survivor));
    assert.equal(await repository.unlinkAccount(user.id, survivor, survivor.linkGeneration), false);
    assert.equal(await addLinkedAccount(database, user.id, revoked, third), "expired");
    const restoredIdentity = outcomes[0] ? second : first;
    assert.equal(await addLinkedAccount(database, user.id, survivor, restoredIdentity), "added");
    assert.equal(await repository.findUserState(user.id, revoked), undefined);
    // 같은 공급자 계정을 다시 연결해도 이전 조회 결과로 이메일을 갱신하거나 인증할 수 없다.
    await assert.rejects(repository.confirmOAuthEmail(outcomes[0] ? secondary : user, "stale@example.test"), /연결이 변경/);
    assert.equal((await repository.findLatestConsent(user.id, "terms")).version, "1");
  } finally {
    // 검증용 DB는 각 테스트에서 독립적으로 닫는다.
    client.close();
  }
});

/** 공급자 검증과 완료 액션 사이에서 기존 세션 발급 없이 연결되는지 확인한다. */
test("마이페이지 추가 액션은 등록을 마쳐도 기존 서비스 세션을 발급하지 않는다", async (context) => {
  // 실제 쓰기 저장소와 로그인 계정 한 건을 준비한다.
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { resolveEnrollment } = require("../src/server/auth/enrollment");
  const { openAuthRepository } = require("../src/server/auth/repository");
  const { resolveOAuthCallback } = require("../src/server/auth/oauth-state");
  const client = createClient({ url: "file::memory:" });
  const database = new G2bDatabase(client);
  await migrateG2bDatabase(client);
  const first = { provider: "google", providerUserId: "first", email: "first@example.test", nickname: "Original", image: null };
  const additional = { ...first, providerUserId: "additional", email: "additional@example.test" };
  const { user } = await resolveEnrollment(database, "signup", first, []);
  const repository = openAuthRepository(database);
  let sessionUser = user;
  let flow;
  let exchanges = 0;
  let issued = 0;
  const originals = new Map();
  /**
   * Next.js 요청과 외부 공급자 경계에 테스트 환경 모듈을 연결한다.
   * @param {string} path 교체할 모듈 경로.
   * @param {object} exports 테스트에서 제공할 내보내기.
   */
  function stub(path, exports) {
    const filename = require.resolve(path);
    originals.set(filename, require.cache[filename]);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }
  context.after(() => {
    // 이 테스트의 연결과 경계 교체를 다른 테스트에 남기지 않는다.
    client.close();
    delete require.cache[require.resolve("../src/features/service-auth/actions.ts")];
    for (const [filename, original] of originals) {
      if (original) require.cache[filename] = original;
      else delete require.cache[filename];
    }
  });
  stub("../src/server/g2b/repository/index.ts", {
    /** 테스트 DB를 실제 저장 호출에 제공한다. */
    getG2bDatabase() { return database; },
  });
  stub("../src/server/auth/current-user.ts", {
    /** 요청마다 현재 테스트 사용자의 세션을 반환한다. */
    async verifyCurrentUser() { return { status: "authenticated", user: sessionUser }; },
  });
  stub("../src/server/auth/oauth-flow.ts", {
    /** 공급자 인증 전 단기 쿠키에 들어갈 흐름을 저장한다. */
    async writeOAuthFlow(value) { flow = value; },
    /** 완료 폼이 제출한 키에 해당하는 저장 상태를 읽는다. */
    async readOAuthFlow(state) { return flow?.state === state ? flow : undefined; },
    /** 일회성 흐름만 소비한다. */
    async clearOAuthFlow(state) { if (flow?.state === state) flow = undefined; },
  });
  stub("../src/server/auth/oauth-providers.ts", { oauthAdapters: { google: {
    /** 정상 인가 주소와 요청 검증값을 시뮬레이션한다. */
    async start() { return { url: "https://example.test/authorize", nonce: "n".repeat(43), verifier: "v".repeat(43) }; },
    /** 정상 공급자 인증으로 확인한 추가 계정을 반환한다. */
    async complete() { exchanges += 1; return additional; },
  } } });
  stub("../src/server/auth/session.ts", {
    /** 세션을 덮어쓰려는 호출이 있으면 기록한다. */
    async issueSession() { issued += 1; },
  });
  const { beginAccountOAuth, finishOAuth } = require("../src/features/service-auth/actions.ts");
  const form = new FormData();
  form.set("provider", "google");
  /**
   * 계정 추가를 시작하고 실제 콜백 상태 전환을 적용한다.
   * @returns 해당 요청을 완료할 폼.
   */
  async function completeForm() {
    await assert.rejects(beginAccountOAuth(form), { digest: /https:\/\/example\.test\/authorize/ });
    const ready = resolveOAuthCallback(flow, "google", new URLSearchParams({ state: flow.state, code: "one-use" }));
    flow = ready.flow;
    const submit = new FormData();
    submit.set("flow", flow.state);
    return submit;
  }
  // 로그인 세대가 달라진 요청과 콜백 재전송은 공급자 교환을 실행하지 않는다.
  const stale = await completeForm();
  sessionUser = { ...user, oauthAccount: { ...user.oauthAccount, linkGeneration: "changed" } };
  await assert.rejects(finishOAuth(stale), { digest: /account=expired/ });
  sessionUser = user;
  const valid = await completeForm();
  await assert.rejects(finishOAuth(valid), { digest: /account=added/ });
  await assert.rejects(finishOAuth(valid), { digest: /notice=failed/ });
  assert.equal(exchanges, 1);
  assert.equal(issued, 0);
  assert.equal((await repository.listLinkedAccounts(user.id)).length, 2);
});
