const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");

test("발주계획 카드와 목록의 집계가 일치하고 공고 부분 인덱스로 조회한다", async () => {
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { openG2bRepository } = require("../src/server/g2b/repository/turso");
  const { orderPlanUnprocessableStatus } = require("../src/shared/config/g2b-order-plan");
  const client = createClient({ url: "file::memory:" });
  try {
    await migrateG2bDatabase(client);
    await client.executeMultiple(`
      DROP INDEX IF EXISTS g2b_notice_order_plan_link;
      DROP INDEX IF EXISTS g2b_notice_order_plan_unavailable;
      DELETE FROM g2b_schema_migrations WHERE version = 11;
      INSERT INTO order_plans VALUES
        ('SAVED', '2026-01-01', '{}', '{}'), ('OWN', '2026-01-01', '{}', '{}');
    `);
    const db = new G2bDatabase(client);
    const prepare = db.prepare.bind(db);
    let cardQuery;
    db.prepare = (sql) => {
      const statement = prepare(sql);
      return { ...statement, get: (...args) => {
        cardQuery = { sql, args };
        return statement.get(...args);
      } };
    };
    const { collectionAttempts: history } = openG2bRepository(db);
    const notices = [
      ["ALIAS", { orderPlanNumber: "SAVED" }],
      ["ALIAS", { orderPlanNumber: "SAVED" }],
      ["AMBIGUOUS", { orderPlanNumber: "SAVED" }],
      ["AMBIGUOUS", { orderPlanNumber: "MISSING" }],
      ["UNSAVED", { orderPlanNumber: "MISSING" }],
      ["OWN", { orderPlanNumber: "SAVED" }],
      ["SAVED", { orderPlanStatus: orderPlanUnprocessableStatus }],
      ["BLOCKED", { orderPlanStatus: orderPlanUnprocessableStatus }],
      [null, { orderPlanStatus: orderPlanUnprocessableStatus }],
    ];
    await client.batch(notices.map(([lookup, data], index) => ({
      sql: "INSERT INTO notices VALUES (?, '000', '2026-01-01', ?, ?)",
      args: [String(index), JSON.stringify(data), JSON.stringify({ orderPlanLookup: lookup })],
    })), "write");
    for (const number of ["ALIAS", "ALIAS", "AMBIGUOUS", "UNSAVED", "OWN", "SAVED", "BLOCKED"]) {
      await history.start({ section: "order-plans", number });
    }
    const expected = { total: 4, collected: 2, uncollected: 2 };
    assert.deepEqual(await history.counts("order-plans"), expected);
    const explain = async () => (await client.execute({
      ...cardQuery, sql: `EXPLAIN QUERY PLAN ${cardQuery.sql}`,
    })).rows.map((row) => row.detail).join("\n");
    const before = await explain();

    await migrateG2bDatabase(client);
    await migrateG2bDatabase(client);
    assert.deepEqual(await history.counts("order-plans"), expected);
    assert.deepEqual((await history.overview("order-plans")).counts, expected);
    const after = await explain();
    const plans = `마이그레이션 적용 전\n${before}\n마이그레이션 적용 후\n${after}`;
    assert.match(after, /USING (?:COVERING )?INDEX g2b_notice_order_plan_link\b/, plans);
    assert.match(after, /USING (?:COVERING )?INDEX g2b_notice_order_plan_unavailable\b/, plans);
    assert.doesNotMatch(after, /SCAN notices(?:\n|$)|UNION USING TEMP B-TREE|count\(DISTINCT\)|CORRELATED/, plans);

    await client.execute("UPDATE notices SET data = '{}' WHERE number = '7'");
    const unblocked = { total: 5, collected: 2, uncollected: 3 };
    assert.deepEqual(await history.counts("order-plans"), unblocked);
    assert.deepEqual((await history.overview("order-plans")).counts, unblocked);
    await client.execute("DELETE FROM notices WHERE number = '3'");
    assert.deepEqual(await history.counts("order-plans"), expected);
    assert.deepEqual((await history.overview("order-plans")).counts, expected);
    assert.deepEqual(await history.counts("prior-specs"), { total: 0, collected: 0, uncollected: 0 });
  } finally {
    client.close();
  }
});

test("Turso 스키마 적용은 재실행할 수 있고 실행권을 한 워커에만 부여한다", async () => {
  const { mkdtempSync, unlinkSync, rmdirSync } = require("node:fs");

  const { tmpdir } = require("node:os");
  const { join } = require("node:path");
  const { pathToFileURL } = require("node:url");
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase, NoticeWorkerLeaseLostError, withNoticeWorkerToken } = require("../src/server/g2b/repository/database");
  const { openG2bRepository } = require("../src/server/g2b/repository/turso");
  const { acquireNoticeWorkerLease } = require("../src/server/g2b/repository/notice-worker-lease");
  const directory = mkdtempSync(join(tmpdir(), "g2b-lease-"));
  const options = { url: pathToFileURL(join(directory, "test.db")).href };
  const firstClient = createClient(options);
  const secondClient = createClient(options);

  try {
    await migrateG2bDatabase(firstClient);
    await migrateG2bDatabase(secondClient);
    const clients = [firstClient, secondClient];
    const leases = await Promise.all(clients.map(acquireNoticeWorkerLease));
    assert.equal(leases.filter(Boolean).length, 1);
    const owner = leases.findIndex(Boolean);
    const first = leases[owner];
    const current = openG2bRepository(new G2bDatabase(clients[owner]));
    const successor = openG2bRepository(new G2bDatabase(clients[1 - owner]));
    const key = { number: "R26BK00000001", revision: "000", methodCode: "" };
    const [id] = await current.noticeQueue.enqueue([key], true);
    await withNoticeWorkerToken(first.token, async () => {
      assert.equal((await current.noticeQueue.claim(0)).id, id);
      await current.collectionAttempts.start({ ...key, section: "notices" }, id);
    });
    assert.equal(await acquireNoticeWorkerLease(clients[1 - owner]), null);
    assert.equal((await successor.noticeQueue.get(id)).status, "running");

    await firstClient.execute("UPDATE g2b_notice_worker_lease SET expires_at = 0");
    const second = await acquireNoticeWorkerLease(clients[1 - owner]);
    assert.ok(second);
    await withNoticeWorkerToken(second.token, async () => {
      await successor.noticeQueue.recover();
      assert.equal((await successor.noticeQueue.get(id)).status, "pending");
      assert.equal((await successor.noticeQueue.claim(0)).executions, 2);
    });

    const outcome = { kind: "success", related: [], result: {} };
    await withNoticeWorkerToken(first.token, async () => {
      await assert.rejects(current.noticeQueue.finish(id, outcome, 0), NoticeWorkerLeaseLostError);
      await assert.rejects(current.save({
        ...key, title: "늦은 응답", payload: {}, collectedAt: new Date().toISOString(),
      }), NoticeWorkerLeaseLostError);
      await assert.rejects(current.collectionAttempts.start({ ...key, section: "notices" }, id), NoticeWorkerLeaseLostError);
    });
    assert.equal(await successor.find(key), null);
    assert.equal((await successor.noticeQueue.get(id)).status, "running");
    assert.equal(await first.renew(), false);
    await first.release();
    assert.equal(await second.renew(), true);
    await withNoticeWorkerToken(second.token, () => successor.noticeQueue.finish(id, outcome, 0));
    assert.equal((await successor.noticeQueue.get(id)).status, "succeeded");
    await second.release();
  } finally {
    firstClient.close();
    secondClient.close();
    // Windows의 네이티브 libSQL 연결은 프로세스가 끝날 때 파일 핸들을 해제할 수 있다.
    try {
      unlinkSync(join(directory, "test.db"));
      rmdirSync(directory);
    } catch (error) {
      if (process.platform !== "win32" || error.code !== "EBUSY") throw error;
    }
  }
});
