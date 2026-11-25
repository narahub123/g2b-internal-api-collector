const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");

/** 선택 계정의 추가 인증과 연결 경쟁에서 사용자·동의 데이터가 보존되는지 확인한다. */
test("추가 인증된 대상만 OAuth 연결을 얻고 이미 다른 대상에 연결된 계정을 옮기지 않는다", async () => {
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { linkEnrollment, resolveEnrollment } = require("../src/server/auth/enrollment");
  // 별도 메모리 DB에서 동일 이메일의 두 계정과 서로 다른 Google ID를 준비한다.
  const client = createClient({ url: "file::memory:" });
  const database = new G2bDatabase(client);
  const newIdentity = { provider: "google", providerUserId: "new-sub", email: "same@example.com", nickname: "New", image: null };
  const proof = (providerUserId) => ({ ...newIdentity, providerUserId });
  try {
    await migrateG2bDatabase(client);
    await client.executeMultiple(`
      INSERT INTO auth_users (id, email, nickname, role) VALUES
        ('selected', 'same@example.com', 'Original', 'ADMIN'), ('other', 'same@example.com', 'Other', 'USER');
      INSERT INTO auth_oauth_accounts (provider, provider_user_id, user_id, link_generation)
        VALUES ('google', 'selected-sub', 'selected', 'selected-generation'), ('google', 'other-sub', 'other', 'other-generation');
      INSERT INTO auth_consent_records (user_id, item_id, version, agreed, agreed_at, created_at)
        VALUES ('selected', 'terms', 'old', 1, 10, 10);
    `);
    assert.deepEqual(await linkEnrollment(database, newIdentity, "selected", proof("new-sub")), { status: "link-proof-failed" });
    assert.deepEqual(await linkEnrollment(database, newIdentity, "selected", proof("other-sub")), { status: "link-proof-failed" });
    assert.equal((await resolveEnrollment(database, "login", newIdentity, [])).status, "signup-required");
    const [first, second] = await Promise.all([
      linkEnrollment(database, newIdentity, "selected", proof("selected-sub")),
      linkEnrollment(database, newIdentity, "other", proof("other-sub")),
    ]);
    assert.equal(first.status, "existing");
    assert.equal(second.status, "link-conflict");
    assert.equal((await resolveEnrollment(database, "login", newIdentity, [])).user.id, "selected");
    assert.equal(first.user.nickname, "Original");
    // 소유를 증명한 계정과 구분해 가입을 시작한 계정으로 세션을 발급한다.
    assert.equal(first.user.oauthAccount.providerUserId, "new-sub");
    assert.equal(first.user.oauthAccount.email, newIdentity.email);
    assert.equal((await client.execute("SELECT role FROM auth_users WHERE id = 'selected'")).rows[0].role, "ADMIN");
    assert.equal((await client.execute("SELECT version FROM auth_consent_records WHERE user_id = 'selected'")).rows[0].version, "old");
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM auth_consent_records")).rows[0].count, 1);

    // 별도 가입은 동일 이메일을 허용하고 초기 동의 기록을 새 사용자에게만 연결한다.
    const separate = await resolveEnrollment(database, "signup", { ...newIdentity, providerUserId: "separate-sub" },
      [{ id: "terms", version: "new", agreed: true }], { allowSeparateAccount: true });
    assert.equal(separate.status, "registered");
    assert.notEqual(separate.user.id, "selected");
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM auth_users")).rows[0].count, 3);
  } finally {
    client.close();
  }
});

/** 시행·마감 경계와 항목별 최신 동의만 재동의 판단에 사용하는지 확인한다. */
test("현재 정책의 버전, 동의 상태, 시행일과 마감일을 기준으로 세션용 상태를 판단한다", async () => {
  const { evaluateConsentRenewal } = require("../src/server/auth/consent-renewal");
  const { startEnrollmentSession } = require("../src/server/auth/enrollment");
  const item = { id: "terms", version: "2", required: true, requiresRenewal: true,
    effectiveAt: "2026-01-01T00:00:00Z", renewalDeadline: "2026-02-01T00:00:00Z" };
  const calls = [];
  const latest = async (id) => { calls.push(id); return { version: "1", agreed: true }; };
  assert.deepEqual(await evaluateConsentRenewal([item], latest, Date.parse(item.effectiveAt) - 1),
    { required: false, overdue: false });
  assert.deepEqual(calls, []);
  assert.deepEqual(await evaluateConsentRenewal([item], latest, Date.parse(item.effectiveAt)),
    { required: true, overdue: false });
  assert.deepEqual(await evaluateConsentRenewal([item], latest, Date.parse(item.renewalDeadline)),
    { required: true, overdue: false });
  assert.deepEqual(await evaluateConsentRenewal([item], latest, Date.parse(item.renewalDeadline) + 1),
    { required: true, overdue: true });
  assert.deepEqual(await evaluateConsentRenewal([item], async () => ({ version: "2", agreed: true }), Date.parse(item.renewalDeadline) + 1),
    { required: false, overdue: false });
  assert.deepEqual(await evaluateConsentRenewal([{ ...item, renewalDeadline: null }],
    async () => ({ version: "2", agreed: false }), Date.parse(item.renewalDeadline) + 1),
    { required: true, overdue: false });
  assert.deepEqual(calls, ["terms", "terms", "terms"]);
  // 공통 세션 발급기에 계산된 기존 회원의 결과가 그대로 전달되는지 확인한다.
  let issued;
  const status = await startEnrollmentSession({
    status: "existing", user: { id: "member", email: "same@example.com", nickname: "Saved", image: null,
      oauthAccount: { provider: "google", providerUserId: "sub", email: "same@example.com", linkGeneration: "generation" } },
  }, async (session) => { issued = session; }, async (id) => {
    assert.equal(id, "member");
    return { required: true, overdue: true };
  });
  assert.equal(status, "authenticated");
  assert.deepEqual(issued.consentRenewal, { required: true, overdue: true });
});
