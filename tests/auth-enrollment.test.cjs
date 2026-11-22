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
