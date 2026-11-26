const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
// 저장소의 TypeScript 경로와 프로젝트 별칭을 테스트에서 해석한다.
require("../scripts/register-project-typescript.cjs");

const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { openInterests, parseInterestKey } = require("../src/server/g2b/repository/interests");

// 마이그레이션을 적용한 격리 DB에서 원본과 관심 항목의 수명을 검증한다.
test("관심 항목은 재수집에서 유지되며 마지막 원본 삭제에서 정리된다", async () => {
  const client = createClient({ url: "file::memory:" });
  try {
    // 실제 스키마로 동일 공고의 두 개찰진행차수를 준비한다.
    await migrateG2bDatabase(client);
    await client.executeMultiple(`
      INSERT INTO auth_users (id, email, nickname) VALUES ('user', 'user@example.test', '회원');
      INSERT INTO opening_results VALUES ('BID', '000', '001', '2026-01-01', '{}', '{}'),
        ('BID', '000', '002', '2026-01-01', '{}', '{}');
      INSERT INTO g2b_interests VALUES ('user', 'opening-results', 'BID', '000', '개찰', '2026-01-01');
      UPDATE opening_results SET collected_at = '2026-01-02';
      DELETE FROM opening_results WHERE opening_revision = '001';
    `);
    // 남은 진행차수가 상세를 제공하는 동안에는 관심 항목을 유지한다.
    assert.equal((await client.execute("SELECT * FROM g2b_interests")).rows.length, 1);
    // 마지막 진행차수를 삭제하면 해당 업무의 관심 항목도 삭제된다.
    await client.execute("DELETE FROM opening_results");
    assert.equal((await client.execute("SELECT * FROM g2b_interests")).rows.length, 0);
  } finally {
    // 다음 테스트에 연결이 남지 않게 한다.
    client.close();
  }
});

// 실제 저장소 호출로 중복 등록, 다른 사용자의 데이터 격리 및 원본 보존을 검증한다.
test("관심 등록은 재시도를 허용하고 삭제는 선택한 사용자 범위에서 처리한다", async () => {
  const client = createClient({ url: "file::memory:" });
  try {
    // 동일 DB에서 두 사용자가 같은 발주계획을 등록할 수 있도록 준비한다.
    await migrateG2bDatabase(client);
    const db = new G2bDatabase(client);
    const interests = openInterests(db);
    const key = parseInterestKey({ type: "order-plans", number: "PLAN", revision: "" });
    assert.ok(key);
    assert.equal(parseInterestKey({ ...key, revision: "000" }), undefined);
    await client.executeMultiple(`
      INSERT INTO auth_users (id, email, nickname) VALUES
        ('a', 'a@example.test', '첫 회원'), ('b', 'b@example.test', '둘째 회원');
      INSERT INTO order_plans VALUES
        ('PLAN', '2026-01-01', '{"payload":{"dlOderPlanM":{"bizNm":"처음 제목"}}}', '{}');
      INSERT INTO notices VALUES
        ('MOCK', '000', '2026-01-01', '{"title":"모의","payload":{"dmItemMap":{"pbancKndNm":"모의공고"}}}', '{}');
    `);
    // 미수집 업무와 모의공고는 요청에서 직접 지정해도 저장하지 않는다.
    assert.equal(await interests.add("a", { ...key, number: "MISSING" }), false);
    assert.equal(await interests.add("a", { type: "notices", number: "MOCK", revision: "000" }), false);
    assert.equal(await interests.has("a", key), false);
    assert.equal(await interests.add("a", key), true);
    const first = (await interests.list("a", undefined, 1)).items[0];
    assert.equal(first.title, "처음 제목");
    // 서버에서 클라이언트로 넘기는 행은 libSQL 전용 객체를 사용하지 않는다.
    assert.equal(Object.getPrototypeOf(first), Object.prototype);
    // 동일 키로 재수집하고 요청을 재시도해도 등록 데이터는 그대로 남는다.
    await client.execute(`INSERT INTO order_plans VALUES
      ('PLAN', '2026-01-02', '{"payload":{"dlOderPlanM":{"bizNm":"새 제목"}}}', '{}')
      ON CONFLICT (number) DO UPDATE SET data = excluded.data, collected_at = excluded.collected_at`);
    assert.equal(await interests.add("a", key), true);
    assert.deepEqual((await interests.list("a", "order-plans", 1)).items, [first]);
    assert.equal(await interests.add("b", key), true);
    assert.equal((await interests.list("b", undefined, 1)).items[0].title, "새 제목");
    // 중복 선택을 삭제 건수에 더하지 않고 다른 사용자의 관심과 원본은 유지한다.
    assert.equal(await interests.remove("a", [key, key]), 1);
    assert.equal(await interests.has("a", key), false);
    assert.equal(await interests.has("b", key), true);
    assert.equal(await interests.remove("b", [key]), 1);
    assert.equal((await client.execute("SELECT number FROM order_plans")).rows.length, 1);
    // 원본 삭제가 먼저 처리되면 뒤따른 등록이 존재하지 않는 업무를 거절한다.
    const deletePlan = db.prepare("DELETE FROM order_plans WHERE number = ?");
    const [, addedAfterDelete] = await Promise.all([deletePlan.run("PLAN"), interests.add("a", key)]);
    assert.equal(addedAfterDelete, false);
    assert.equal(await interests.has("a", key), false);
    // 등록이 먼저 처리되면 뒤따른 원본 삭제의 트리거가 관심 행을 정리한다.
    await client.execute(`INSERT INTO order_plans VALUES
      ('PLAN', '2026-01-03', '{"payload":{"dlOderPlanM":{"bizNm":"다시 수집한 제목"}}}', '{}')`);
    const [addedBeforeDelete] = await Promise.all([interests.add("a", key), deletePlan.run("PLAN")]);
    assert.equal(addedBeforeDelete, true);
    assert.equal(await interests.has("a", key), false);
  } finally {
    // 테스트가 끝나면 격리 DB를 닫는다.
    client.close();
  }
});

// 각 원본 테이블의 삭제 트리거가 업무 유형과 정확한 번호·차수에만 적용되는지 확인한다.
test("여섯 업무의 원본 삭제가 해당 관심 행만 제거한다", async () => {
  const client = createClient({ url: "file::memory:" });
  try {
    await migrateG2bDatabase(client);
    await client.executeMultiple(`
      INSERT INTO auth_users (id, email, nickname) VALUES ('user', 'user@example.test', '회원');
      INSERT INTO order_plans VALUES ('ITEM', '2026-01-01', '{}', '{}');
      INSERT INTO prior_specs VALUES ('ITEM', '2026-01-01', '{}', '{}');
      INSERT INTO notices VALUES ('ITEM', '000', '2026-01-01', '{}', '{}'), ('ITEM', '001', '2026-01-01', '{}', '{}');
      INSERT INTO contracts VALUES ('ITEM', '00', '2026-01-01', '{}', '{}');
      INSERT INTO contract_requests VALUES ('ITEM', '000', '2026-01-01', '{}', '{}');
      INSERT INTO opening_results VALUES ('ITEM', '000', '001', '2026-01-01', '{}', '{}');
      INSERT INTO g2b_interests VALUES
        ('user', 'order-plans', 'ITEM', '', '발주', '2026-01-01'),
        ('user', 'prior-specs', 'ITEM', '', '규격', '2026-01-01'),
        ('user', 'notices', 'ITEM', '000', '공고', '2026-01-01'),
        ('user', 'notices', 'ITEM', '001', '다른 차수', '2026-01-01'),
        ('user', 'contracts', 'ITEM', '00', '계약', '2026-01-01'),
        ('user', 'contract-requests', 'ITEM', '000', '요청', '2026-01-01'),
        ('user', 'opening-results', 'ITEM', '000', '개찰', '2026-01-01');
    `);
    // 유형마다 하나씩 원본을 지워 정확히 한 관심 행이 줄어드는지 확인한다.
    const deletions = [
      "DELETE FROM order_plans", "DELETE FROM prior_specs", "DELETE FROM notices WHERE revision = '000'",
      "DELETE FROM contracts", "DELETE FROM contract_requests", "DELETE FROM opening_results",
    ];
    for (const [index, sql] of deletions.entries()) {
      await client.execute(sql);
      assert.equal((await client.execute("SELECT title FROM g2b_interests")).rows.length, 6 - index);
    }
    assert.equal((await client.execute("SELECT title FROM g2b_interests")).rows[0].title, "다른 차수");
  } finally {
    client.close();
  }
});
