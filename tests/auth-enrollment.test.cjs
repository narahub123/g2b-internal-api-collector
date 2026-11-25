// 저장 결과와 사용자 상태를 비교하는 Node 단언 도구.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
// 가입 시나리오를 독립 실행할 테스트 함수.
const { G2bDatabase } = require("../src/server/g2b/repository/database");

const items = [
  { id: "terms", version: "1", required: true, effectiveAt: "2026-01-01T00:00:00Z" },
  { id: "optional", version: "1", required: false, effectiveAt: "2026-01-01T00:00:00Z" },
];
const identity = { provider: "google", providerUserId: "first", email: "test@example.com", nickname: "New", image: null };

/** 두 OAuth 계정의 세션은 같은 내부 프로필과 계정별 인증 이메일을 사용한다. */
test("연결 계정별 이메일만 갱신하고 내부 프로필과 연결 세대를 보존한다", async () => {
  // 독립 DB에서 실제 가입·로그인과 세션 발급 경계를 검증한다.
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { resolveEnrollment, startEnrollmentSession } = require("../src/server/auth/enrollment");
  const client = createClient({ url: "file::memory:" });
  const database = new G2bDatabase(client);
  try {
    // 첫 계정을 가입시키고 이메일 미확인 상태인 두 번째 연결을 준비한다.
    await migrateG2bDatabase(client);
    const first = await resolveEnrollment(database, "signup", identity, []);
    await client.execute({
      sql: "INSERT INTO auth_oauth_accounts (provider, provider_user_id, user_id, link_generation) VALUES ('google', 'second', ?, 'second-generation')",
      args: [first.user.id],
    });
    // 두 번째 계정으로 로그인해 실제 인증 이메일과 내부 프로필을 비교한다.
    const secondIdentity = { ...identity, providerUserId: "second", email: "other@example.com", nickname: "Changed" };
    const second = await resolveEnrollment(database, "login", secondIdentity, []);
    const sessions = [];
    /**
     * 공통 세션 발급기에 전달된 실제 프로필을 다음 단언에서 비교하도록 보관한다.
     * @param {object} session 로그인 계정과 동의 상태를 담은 세션.
     */
    async function captureSession(session) {
      // 발급 순서대로 저장해 계정별 세션을 비교한다.
      sessions.push(session);
    }
    /**
     * 현재 정책의 재동의 대상이 없는 가입·로그인 픽스처를 제공한다.
     * @returns {Promise<object>} 재동의 및 기한 초과가 없는 상태.
     */
    async function noRenewal() {
      // 로그인 계정 비교에 영향을 주는 재동의 정책은 적용하지 않는다.
      return { required: false, overdue: false };
    }
    // 동일한 공통 발급 경로에서 각 계정의 세션 자료를 수집한다.
    for (const result of [first, second]) {
      assert.equal(await startEnrollmentSession(result, captureSession, noRenewal), "authenticated");
    }
    assert.deepEqual(sessions.map(({ id, nickname, oauthAccount }) => [id, nickname, oauthAccount.email]), [
      [first.user.id, identity.nickname, identity.email],
      [first.user.id, identity.nickname, secondIdentity.email],
    ]);
    assert.equal(sessions[1].oauthAccount.linkGeneration, "second-generation");
    // 동일 이메일 재인증과 이메일 미제공 시 계정 행을 다시 쓰지 않는다.
    await client.execute("CREATE TRIGGER reject_oauth_update BEFORE UPDATE ON auth_oauth_accounts BEGIN SELECT RAISE(ABORT, 'unexpected update'); END");
    await resolveEnrollment(database, "login", secondIdentity, []);
    const withoutEmail = await resolveEnrollment(database, "login", { ...secondIdentity, email: null }, []);
    assert.equal(withoutEmail.user.oauthAccount.email, null);
    assert.equal((await client.execute("SELECT email FROM auth_oauth_accounts WHERE provider_user_id = 'second'")).rows[0].email,
      secondIdentity.email);
  } finally {
    // 케이스에서 사용한 격리 DB를 닫는다.
    client.close();
  }
});

/** 기존 쿠키와 새 OAuth 연결이 포함된 쿠키의 판독 호환성을 검증한다. */
test("OAuth 연결 정보가 포함된 쿠키를 읽고 구형 쿠키도 허용한다", async () => {
  // 테스트 전용 키로 실제 Auth.js 토큰을 만들고 케이스가 끝나면 환경을 복원한다.
  const secret = "stage-one-auth-cookie-test-secret";
  const { encode } = await import("next-auth/jwt");
  const { readSessionCookie, sessionCookieName } = require("../src/server/auth/session-cookie");
  const profile = {
    id: "internal-user", email: identity.email, nickname: identity.nickname, image: null,
    consentRenewal: { required: false, overdue: false },
  };
  const oauthAccount = {
    provider: identity.provider, providerUserId: identity.providerUserId, email: identity.email, linkGeneration: "generation",
  };
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = secret;
  try {
    // 구형 구조, 정상 신규 구조, 연결 세대가 누락된 신규 구조를 차례로 확인한다.
    for (const [serviceUser, expected] of [
      [profile, profile],
      [{ ...profile, oauthAccount }, { ...profile, oauthAccount }],
      [{ ...profile, oauthAccount: { ...oauthAccount, linkGeneration: "" } }, null],
    ]) {
      // 발급 모듈과 동일한 이름과 암호화 설정을 사용한다.
      const token = await encode({ token: { serviceUser }, secret, salt: sessionCookieName });
      const headers = new Headers({ cookie: sessionCookieName + "=" + token });
      assert.deepEqual(await readSessionCookie(headers), expected);
    }
  } finally {
    // 후속 테스트에서 기존 인증 환경을 그대로 사용한다.
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  }
});

test("서버가 필수 동의와 항목별 버전을 검증한다", () => {
  const { validateSignupConsent } = require("../src/server/auth/enrollment");
  const draft = (id, agreed, version = "1") => ({ id, version, agreed });
  assert.equal(validateSignupConsent(items, [draft("terms", false), draft("optional", true)]), false);
  assert.equal(validateSignupConsent(items, [draft("terms", true, "old"), draft("optional", false)]), false);
  assert.equal(validateSignupConsent(items, [draft("terms", true), draft("optional", false)]), true);
});

test("동시에 제출한 같은 OAuth 가입은 내부 계정 하나에 연결된다", async () => {
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { resolveEnrollment } = require("../src/server/auth/enrollment");
  const client = createClient({ url: "file::memory:" });
  // 운영 DB 없이 로컬 검증 DB를 열 libSQL 클라이언트.
  const database = new G2bDatabase(client);
  try {
    await migrateG2bDatabase(client);
    const consent = [{ id: "terms", version: "1", agreed: true }];
    const results = await Promise.all([
      resolveEnrollment(database, "signup", identity, consent),
      resolveEnrollment(database, "signup", identity, consent),
    ]);
    assert.deepEqual(results.map(({ status }) => status).sort(), ["existing", "registered"]);
    assert.equal(results[0].user.id, results[1].user.id);
    assert.equal((await client.execute("SELECT count(*) AS n FROM auth_users")).rows[0].n, 1);
    assert.equal((await client.execute("SELECT count(*) AS n FROM auth_consent_records")).rows[0].n, 1);
  } finally {
    client.close();
  }
});

test("가입 저장, 미등록 로그인, 기존 회원, 후보 차단 및 저장 롤백을 구분한다", async () => {
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { resolveEnrollment, startEnrollmentSession } = require("../src/server/auth/enrollment");
  const client = createClient({ url: "file::memory:" });
  // 프로젝트 경로 별칭과 TypeScript 모듈을 테스트에서도 해석한다.
  const database = new G2bDatabase(client);
  const consent = [{ id: "terms", version: "1", agreed: true }, { id: "optional", version: "1", agreed: false }];
  try {
    await migrateG2bDatabase(client);
    await client.execute("CREATE TRIGGER fail_optional BEFORE INSERT ON auth_consent_records WHEN NEW.item_id = 'optional' BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
    assert.deepEqual(await resolveEnrollment(database, "login", identity, []), { status: "signup-required" });
    assert.deepEqual(await resolveEnrollment(database, "signup", { ...identity, nickname: null }, consent), { status: "incomplete-profile" });
    await assert.rejects(resolveEnrollment(database, "signup", identity, consent), /test rollback/);
    for (const table of ["auth_users", "auth_oauth_accounts", "auth_consent_records"]) {
      assert.equal((await client.execute("SELECT count(*) AS n FROM " + table)).rows[0].n, 0);
    }
    await client.execute("DROP TRIGGER fail_optional");
    const registered = await resolveEnrollment(database, "signup", identity, consent);
    assert.equal(registered.status, "registered");
    let issueCalls = 0;
    const failSession = async () => { issueCalls += 1; throw new Error("test session failure"); };
    const evaluate = async () => ({ required: true, overdue: false });
    assert.equal(await startEnrollmentSession(registered, failSession, evaluate), "registered-session-failed");
    assert.equal(issueCalls, 1);
    const existing = await resolveEnrollment(database, "login", identity, []);
    assert.equal(await startEnrollmentSession(existing, failSession, evaluate), "session-failed");
    assert.equal(await startEnrollmentSession({ status: "signup-required" }, failSession, evaluate), "signup-required");
    assert.equal(await startEnrollmentSession({ status: "link-required" }, failSession, evaluate), "link-required");
    assert.equal(issueCalls, 2);
    assert.deepEqual(await resolveEnrollment(database, "signup", { ...identity, nickname: "Changed" }, consent),
      { status: "existing", user: registered.user });
    assert.deepEqual(await resolveEnrollment(database, "login", { ...identity, providerUserId: "second" }, []),
      { status: "signup-required" });
    assert.deepEqual(await resolveEnrollment(database, "signup", { ...identity, providerUserId: "second" }, consent),
      { status: "link-required" });
    const records = (await client.execute("SELECT agreed, agreed_at FROM auth_consent_records ORDER BY id")).rows;
    assert.equal(records.length, 2);
    assert.ok(records[0].agreed_at > 0);
    assert.equal(records[1].agreed, 0);
    assert.equal(records[1].agreed_at, null);
  } finally {
    client.close();
  }
});
