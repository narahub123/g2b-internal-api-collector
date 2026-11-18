const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");

test("개찰결과 카드는 공고를 읽지 않고 복합 키로 미수집 건수를 집계한다", async () => {
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { openG2bRepository } = require("../src/server/g2b/repository/turso");
  const client = createClient({ url: "file::memory:" });
  try {
    await migrateG2bDatabase(client);
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
    assert.deepEqual(await history.counts("opening-results"), { total: 0, collected: 0, uncollected: 0 });
    await client.executeMultiple(`
      INSERT INTO notices VALUES ('BID', '000', '2026-01-01', '{}', '{}');
      INSERT INTO opening_results VALUES
        ('BID', '000', '001', '2026-01-01', '{}', '{}'),
        ('SAVED', '000', '001', '2026-01-01', '{}', '{}');
      INSERT INTO g2b_collection_attempts (section, number, revision, opening_revision, input, started_at)
      VALUES ('opening-results', 'BID', '000', '001', '{}', '2026-01-01'),
        ('opening-results', 'BID', '000', '002', '{}', '2026-01-01'),
        ('opening-results', 'BID', '000', '002', '{}', '2026-01-02'),
        ('opening-results', 'BID', '001', '001', '{}', '2026-01-01'),
        ('notices', 'OTHER', '000', '', '{}', '2026-01-01');
    `);
    const counts = await history.counts("opening-results");
    assert.deepEqual(counts, { total: 4, collected: 2, uncollected: 2 });
    assert.deepEqual(counts, (await history.overview("opening-results")).counts);

    const plan = (await client.execute({
      ...cardQuery, sql: `EXPLAIN QUERY PLAN ${cardQuery.sql}`,
    })).rows.map((row) => row.detail).join("\n");
    assert.doesNotMatch(plan, /\bnotice\b|\bnotices\b|UNION USING TEMP B-TREE/);
    assert.equal([...plan.matchAll(/SCAN opening_results\b/g)].length, 1, plan);
    assert.match(plan, /g2b_collection_attempts_target \(section=\?\)/);
    assert.match(plan, /sqlite_autoindex_opening_results_1 FOR IN-OPERATOR/);
  } finally {
    client.close();
  }
});

test("발주계획 카드가 목록과 같은 건수를 반환하고 시도 번호별로 공고를 탐색한다", async () => {
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
      ["ALIAS2", { orderPlanNumber: "SAVED" }],
      ["OTHER", { orderPlanNumber: "OWN" }],
      ["OTHER", { orderPlanStatus: orderPlanUnprocessableStatus }],
    ];
    await client.batch(notices.map(([lookup, data], index) => ({
      sql: "INSERT INTO notices VALUES (?, '000', '2026-01-01', ?, ?)",
      args: [String(index), JSON.stringify(data), JSON.stringify({ orderPlanLookup: lookup })],
    })), "write");
    for (const number of ["ALIAS", "ALIAS", "ALIAS2", "AMBIGUOUS", "UNSAVED", "OWN", "SAVED", "BLOCKED"]) {
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
    const linkSearch = /SEARCH notices USING (?:COVERING )?INDEX g2b_notice_order_plan_link \(<expr>=\?\)/g;
    assert.equal([...after.matchAll(linkSearch)].length, 2, plans);
    assert.match(after, /SEARCH notices USING (?:COVERING )?INDEX g2b_notice_order_plan_unavailable \(<expr>=\?\)/, plans);
    assert.doesNotMatch(after, /SCAN notices\b|SCAN alias\b|UNION USING TEMP B-TREE|ORDER BY/, plans);

    await client.execute("UPDATE notices SET data = '{}' WHERE number = '7'");
    const unblocked = { total: 5, collected: 2, uncollected: 3 };
    assert.deepEqual(await history.counts("order-plans"), unblocked);
    assert.deepEqual((await history.overview("order-plans")).counts, unblocked);
    await client.execute("DELETE FROM notices WHERE number = '3'");
    assert.deepEqual(await history.counts("order-plans"), expected);
    assert.deepEqual((await history.overview("order-plans")).counts, expected);
    // 기존 이력에 차수가 있으면 저장 행과 다른 키이며, 정규화 후 같은 키는 한 건으로 센다.
    await client.execute(`
      INSERT INTO g2b_collection_attempts (section, number, revision, opening_revision, input, started_at)
      VALUES ('order-plans', 'ALIAS', '001', '', '{}', '2026-01-01'),
        ('order-plans', 'ALIAS2', '001', '', '{}', '2026-01-01'),
        ('order-plans', 'OTHER', '001', '', '{}', '2026-01-01')
    `);
    await client.execute("UPDATE notices SET data = '{}' WHERE number = '6'");
    assert.deepEqual(await history.counts("order-plans"), { total: 6, collected: 2, uncollected: 4 });
    assert.deepEqual(await history.counts("order-plans"), (await history.overview("order-plans")).counts);
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
