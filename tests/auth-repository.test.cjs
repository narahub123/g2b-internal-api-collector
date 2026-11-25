const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");

test("인증 마이그레이션은 중복 이메일, OAuth 고유 연결, 동의 이력과 조회 인덱스를 지원한다", async () => {
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { authQueries, openAuthRepository } = require("../src/server/auth/repository");
  const client = createClient({ url: "file::memory:" });
  try {
    await migrateG2bDatabase(client);
    await migrateG2bDatabase(client);
    const db = openAuthRepository(client);
    await client.executeMultiple(`
      INSERT INTO auth_users (id, email, nickname) VALUES ('a', 'x@example.com', 'A'), ('b', 'X@example.com', 'B');
      INSERT INTO auth_oauth_accounts (provider, provider_user_id, user_id, link_generation)
        VALUES ('google', 'first', 'a', 'first-generation'), ('google', 'second', 'a', 'second-generation');
      INSERT INTO auth_consent_records (user_id, item_id, version, agreed, agreed_at, created_at) VALUES
        ('a', 'terms', '1', 1, 10, 10), ('a', 'terms', '1', 0, NULL, 10);
    `);
    // 이미 연결된 공급자 키는 다른 내부 사용자에 다시 연결할 수 없다.
    await assert.rejects(client.execute("INSERT INTO auth_oauth_accounts (provider, provider_user_id, user_id, link_generation) VALUES ('google', 'first', 'b', 'conflict-generation')"), /UNIQUE/);
    assert.deepEqual(await db.findUserState("a"), { id: "a", role: "USER" });
    await client.execute("UPDATE auth_users SET role = 'ADMIN' WHERE id = 'a'");
    assert.deepEqual(await db.findUserState("a"), { id: "a", role: "ADMIN" });
    assert.equal((await db.findUserByOAuth("google", "second")).id, "a");
    assert.deepEqual((await db.findEmailCandidates("x@example.com")).map(({ id }) => id), ["a", "b"]);
    assert.equal((await db.findLatestConsent("a", "terms")).agreed, false);
    assert.equal((await client.execute("SELECT count(*) AS count FROM auth_consent_records")).rows[0].count, 2);
    for (const [sql, args, index] of [
      [authQueries.userState, ["a"], /SEARCH.*PRIMARY KEY|SEARCH.*sqlite_autoindex_auth_users/],
      [authQueries.emailCandidates, ["x@example.com"], /SEARCH.*auth_users_email/],
      [authQueries.latestConsent, ["a", "terms"], /SEARCH.*auth_consent_latest/],
    ]) {
      const plan = (await client.execute({ sql: "EXPLAIN QUERY PLAN " + sql, args })).rows.map(({ detail }) => detail).join("\n");
      assert.match(plan, index);
      assert.doesNotMatch(plan, /TEMP B-TREE/);
    }
    await client.execute("DELETE FROM auth_users WHERE id = 'a'");
    assert.equal(await db.findUserState("a"), undefined);
    assert.equal(await db.findUserByOAuth("google", "first"), undefined);
  } finally {
    client.close();
  }
});
