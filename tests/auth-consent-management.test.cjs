const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");

// 버전 변경, 시행 및 마감 시각을 재현하는 필수·선택 문서.
const policies = [
  { id: "terms", title: "약관", content: "약관 원문", version: "2", required: true,
    requiresRenewal: true, effectiveAt: "2026-01-01T00:00:00Z", renewalDeadline: "2026-02-01T00:00:00Z" },
  { id: "optional", title: "선택 항목", content: "선택 원문", version: "2", required: false,
    requiresRenewal: true, effectiveAt: "2026-01-01T00:00:00Z", renewalDeadline: "2026-02-01T00:00:00Z" },
];
// 마감 후 동의와 철회를 검증할 고정 시각.
const now = Date.parse("2026-03-01T00:00:00Z");

/** 선택 항목 미동의와 철회는 세션 재동의를 유발하지 않는지 확인한다. */
test("선택 항목은 이전 버전에 동의한 사용자만 재동의 대상으로 판단한다", async () => {
  const { evaluateConsentRenewal } = require("../src/server/auth/consent-renewal");
  const optional = policies.slice(1);
  // 선택 미동의·철회와 필수 미동의에서 정책을 구분한다.
  for (const latest of [undefined, { version: "1", agreed: false }, { version: "2", agreed: true }]) {
    assert.deepEqual(await evaluateConsentRenewal(optional, async () => latest, now), { required: false, overdue: false });
  }
  assert.deepEqual(await evaluateConsentRenewal(optional, async () => ({ version: "1", agreed: true }), now),
    { required: true, overdue: true });
  assert.deepEqual(await evaluateConsentRenewal(policies.slice(0, 1), async () => undefined, now),
    { required: true, overdue: true });
});

/** 동의 저장 뒤 일시적인 세션 쿠키 실패와 재시도 시 이력 보존을 확인한다. */
test("쿠키 갱신에 실패한 동의는 이력 쓰기 없이 세션만 다시 반영한다", async (context) => {
  // 저장은 실제 DB에서 진행하고 요청 인증과 쿠키 발급 경계만 대체한다.
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const client = createClient({ url: "file::memory:" });
  const database = new G2bDatabase(client);
  const originals = new Map();
  /**
   * 요청 경계 대신 테스트 객체를 제공한다.
   * @param {string} path 교체할 모듈 경로.
   * @param {object} exports 테스트에서 제공할 모듈 인터페이스.
   */
  function stub(path, exports) {
    const filename = require.resolve(path);
    originals.set(filename, require.cache[filename]);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }
  context.after(() => {
    // 테스트가 사용한 모듈 캐시와 연결만 정리한다.
    client.close();
    delete require.cache[require.resolve("../src/features/service-auth/consent-actions.ts")];
    for (const [filename, original] of originals) {
      if (original) require.cache[filename] = original;
      else delete require.cache[filename];
    }
  });
  await migrateG2bDatabase(client);
  await client.execute("INSERT INTO auth_users(id,email,nickname) VALUES ('member','member@example.test','Member')");
  const oauthAccount = { provider: "google", providerUserId: "member-sub", linkGeneration: "current", email: "oauth@example.test" };
  let user = { id: "member", email: "member@example.test", nickname: "Member", image: null,
    oauthAccount, consentRenewal: { required: true, overdue: true } };
  let attempts = 0;
  stub("../src/server/g2b/repository/index.ts", {
    /** 격리 DB만 기본 작업에 제공한다. */
    getG2bDatabase() { return database; },
  });
  stub("../src/server/auth/current-user.ts", {
    /** 요청의 현재 쿠키 상태로 인증된 사용자를 반환한다. */
    async verifyCurrentUser() { return { status: "authenticated", user }; },
  });
  stub("../src/server/auth/session.ts", {
    /** 첫 호출에서 쿠키 전송 실패를 재현하고 두 번째 호출은 저장한다. */
    async issueSession(next) {
      attempts += 1;
      if (attempts === 1) throw new Error("test cookie failure");
      user = next;
    },
  });
  const { submitConsentChange, refreshConsentSession } = require("../src/features/service-auth/consent-actions.ts");
  // 현재 시행 중인 문서를 확인한 폼을 실제 서버 액션에 전달한다.
  const form = new FormData();
  form.set("item", "terms");
  form.set("operation", "agree");
  form.set("version:terms", "preview-1");
  form.set("consent:terms", "on");
  assert.equal(await submitConsentChange(form), "session-pending");
  assert.equal((await client.execute("SELECT count(*) AS n FROM auth_consent_records")).rows[0].n, 1);
  assert.equal(await refreshConsentSession(), "saved");
  assert.deepEqual(user.consentRenewal, { required: false, overdue: false });
  assert.deepEqual(user.oauthAccount, oauthAccount);
  assert.equal(await submitConsentChange(form), "saved");
  assert.equal(attempts, 2);
  assert.equal((await client.execute("SELECT count(*) AS n FROM auth_consent_records")).rows[0].n, 1);
});

/** 실제 이력 저장, 버전 검증, 중복 방지와 화면용 최신 상태를 검증한다. */
test("동의 변경은 새 기록만 남기고 재시도해도 중복 저장하지 않는다", async () => {
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { openAuthRepository } = require("../src/server/auth/repository");
  const { recordConsentChange, loadConsentManagement } = require("../src/server/auth/consent-management");
  // 기존 동의 두 건을 가진 격리 가입자 상태를 준비한다.
  const client = createClient({ url: "file::memory:" });
  const database = new G2bDatabase(client);
  const repository = openAuthRepository(database);
  try {
    await migrateG2bDatabase(client);
    await client.executeMultiple(`INSERT INTO auth_users(id,email,nickname) VALUES ('member','member@example.test','Member');
      INSERT INTO auth_consent_records(user_id,item_id,version,agreed,agreed_at,created_at)
      VALUES ('member','terms','1',1,10,10),('member','optional','1',1,10,10);`);
    const shown = await loadConsentManagement(repository, "member", policies, now);
    assert.equal(shown.items.every(({ renewal, content }) => renewal && content), true);
    assert.deepEqual(shown.renewal, { required: true, overdue: true });
    // 필수 항목 철회와 화면에 있던 구버전 제출은 모두 차단한다.
    assert.deepEqual(await recordConsentChange(database, "member", policies, { id: "terms", version: "2", agreed: false }, now), { status: "invalid" });
    assert.deepEqual(await recordConsentChange(database, "member", policies, { id: "terms", version: "1", agreed: true }, now), { status: "stale" });
    // 오래된 선택 동의를 철회한 후 같은 요청을 재시도해도 한 건만 추가한다.
    const withdrawal = { id: "optional", version: "2", agreed: false };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.deepEqual(await recordConsentChange(database, "member", policies, withdrawal, now),
        { status: "saved", renewal: { required: true, overdue: true } });
    }
    assert.deepEqual(await recordConsentChange(database, "member", policies, { id: "terms", version: "2", agreed: true }, now),
      { status: "saved", renewal: { required: false, overdue: false } });
    const rows = (await client.execute("SELECT item_id,version,agreed,agreed_at FROM auth_consent_records ORDER BY id")).rows;
    assert.deepEqual(rows.map(({ item_id, version, agreed, agreed_at }) => [item_id, version, agreed, agreed_at]),
      [["terms", "1", 1, 10], ["optional", "1", 1, 10], ["optional", "2", 0, null], ["terms", "2", 1, now]]);
    const { items: [terms, optional], renewal } = await loadConsentManagement(repository, "member", policies, now);
    assert.equal(terms.content, null);
    assert.equal(optional.agreed, false);
    assert.equal(optional.renewal, false);
    assert.equal(optional.content, "선택 원문");
    assert.deepEqual(renewal, { required: false, overdue: false });
    // 철회한 선택 항목에 다시 동의하면 새 동의 일자와 기록이 추가된다.
    await recordConsentChange(database, "member", policies, { ...withdrawal, agreed: true }, now + 1);
    const accepted = (await loadConsentManagement(repository, "member", policies, now + 1)).items[1];
    assert.deepEqual([accepted.agreed, accepted.agreedAt, accepted.content], [true, now + 1, null]);
  } finally {
    client.close();
  }
});
