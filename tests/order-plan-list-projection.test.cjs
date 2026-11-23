const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { openG2bRepository } = require("../src/server/g2b/repository/turso");

/** 발주계획 연결이 달라지면 목록·건수·삭제·재수집이 같은 키를 사용하는지 확인한다. */
test("발주계획 연결과 조회 불가 상태가 목록 키 및 집계에 반영된다", async () => {
  // 독립 DB에서 실제 마이그레이션과 발주계획 저장소를 연다.
  const client = createClient({ url: "file::memory:" });
  try {
    await migrateG2bDatabase(client);
    const db = new G2bDatabase(client);
    const repo = openG2bRepository(db);
    const history = repo.collectionAttempts;
    const list = history.orderPlanList;
    const query = { search: { field: "title", query: "" }, filters: {}, sort: "released-desc", status: "total", page: 1 };
    const countsSql = "SELECT total, collected FROM g2b_collection_list_counts WHERE section='order-plans' AND scope='all'";
    const key = { section: "order-plans", number: "RAW", revision: "", openingRevision: "" };
    // 원래 호출 번호로 수집한 실패 이력은 저장본이 생기기 전까지 원래 키에 남는다.
    const id = await history.start(key);
    await history.finish(id, "failed");
    await db.execute(`INSERT INTO notices VALUES
      ('N1','000','2026-01-01','{"orderPlanNumber":"PLAN"}','{"orderPlanLookup":"RAW"}'),
      ('N2','000','2026-01-01','{"orderPlanNumber":"PLAN"}','{"orderPlanLookup":"RAW"}')`);
    assert.deepEqual((await db.execute(countsSql)).rows, [{ total: 1, collected: 0 }]);
    assert.equal((await list.page(query)).rows[0].number, "RAW");
    // 연결 대상이 저장되면 두 공고가 동일한 번호를 가리키므로 실패 이력을 저장 행에 합친다.
    await db.execute("INSERT INTO order_plans VALUES ('PLAN','2026-01-01','{}','{}')");
    const snapshot = await repo.collectionDeletion.snapshot("order-plans", { ...key, number: "PLAN" });
    assert.equal(snapshot.target.attemptId, id);
    assert.equal((await history.retryTarget(id)).number, "PLAN");
    assert.deepEqual((await db.execute(countsSql)).rows, [{ total: 1, collected: 1 }]);
    // 연결된 최신 이력이 진행 중이면 저장 번호로 삭제할 수 없고 이전 이력은 재시도 대상이 아니다.
    const latestId = await history.start(key);
    const busy = await repo.collectionDeletion.snapshot("order-plans", { ...key, number: "PLAN" });
    assert.equal(busy.target.attemptId, latestId);
    assert.equal(busy.blocked, true);
    assert.deepEqual(await repo.collectionDeletion.remove("order-plans", [busy.target]), { ok: false, reason: "busy" });
    assert.equal(await history.retryTarget(id), "conflict");
    // 최신 시도 하나를 삭제하면 연결된 같은 차수의 이전 ID가 다시 최신이 된다.
    await db.execute({ sql: "DELETE FROM g2b_collection_attempts WHERE id = ?", args: [latestId] });
    assert.equal((await history.retryTarget(id)).number, "PLAN");
    // 모호한 연결, 원래 번호의 저장, 미존재 판정이 같은 트랜잭션에서 갱신되는지 확인한다.
    await assert.rejects(db.transaction(async () => {
      await db.execute("UPDATE notices SET data='{\"orderPlanNumber\":\"OTHER\"}' WHERE number='N2'");
      assert.equal((await history.retryTarget(id)).number, "RAW");
      assert.deepEqual((await list.page(query)).counts, { total: 2, collected: 1, uncollected: 1 });
      await db.execute("UPDATE notices SET data='{\"orderPlanNumber\":\"PLAN\"}' WHERE number='N2'");
      await db.execute("INSERT INTO order_plans VALUES ('RAW','2026-01-01','{}','{}')");
      assert.equal((await history.retryTarget(id)).number, "RAW");
      await db.execute("DELETE FROM order_plans WHERE number='RAW'");
      await db.execute("DELETE FROM order_plans WHERE number='PLAN'");
      await db.execute(`INSERT INTO notices VALUES
        ('N3','000','2026-01-01','{"orderPlanStatus":"unprocessable-entity"}','{"orderPlanLookup":"RAW"}')`);
      assert.deepEqual((await db.execute(countsSql)).rows, [{ total: 0, collected: 0 }]);
      await db.execute("DELETE FROM notices WHERE number='N3'");
      assert.equal((await list.page(query)).rows[0].number, "RAW");
      throw new Error("검증용 롤백");
    }), /검증용 롤백/);
    // 롤백과 마이그레이션 재실행 뒤 집계 및 삭제 대상이 복원된다.
    await migrateG2bDatabase(client);
    assert.deepEqual((await db.execute(countsSql)).rows, [{ total: 1, collected: 1 }]);
    assert.equal((await history.retryTarget(id)).number, "PLAN");

    // 기본 목록과 삭제 확인의 실제 SQL에서 집계 키, 정렬과 이력 인덱스를 확인한다.
    const execute = db.execute.bind(db);
    const statements = [];
    db.execute = (statement) => {
      statements.push(statement);
      return execute(statement);
    };
    await list.page(query);
    await repo.collectionDeletion.snapshot("order-plans", { ...key, number: "PLAN" });
    db.execute = execute;
    const plans = [];
    for (const statement of statements) {
      const { rows } = await client.execute({ ...statement, sql: `EXPLAIN QUERY PLAN ${statement.sql}` });
      plans.push(rows.map(({ detail }) => detail).join("\n"));
    }
    assert.match(plans[0], /SEARCH g2b_collection_list_counts USING PRIMARY KEY/);
    assert.match(plans[0], /USING INDEX g2b_order_plan_list_released/);
    assert.match(plans[2], /USING COVERING INDEX g2b_order_plan_aliases_reverse/);
    assert.match(plans[2], /SEARCH attempt USING COVERING INDEX g2b_collection_attempts_target/);
    assert.equal((await repo.collectionDeletion.remove("order-plans", [snapshot.target])).ok, true);
    assert.deepEqual((await list.page(query)).counts, { total: 0, collected: 0, uncollected: 0 });
  } finally {
    // 테스트 연결을 반환한다.
    client.close();
  }
});
