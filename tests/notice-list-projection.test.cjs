const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { noticeListSchema } = require("../src/server/g2b/repository/notice-list-schema");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { openNoticeList } = require("../src/server/g2b/repository/notice-list");

/** 기존 시도를 초기화하고 원본 변경에 따라 페이지와 선택지가 즉시 갱신되는지 검증한다. */
test("입찰공고 목록이 최신 시도, 정확한 집계 및 선택지를 유지한다", async () => {
  // 전체 마이그레이션을 적용한 메모리 DB에 저장 공고와 실패 이력을 구성한다.
  const client = createClient({ url: "file::memory:" });
  try {
    await migrateG2bDatabase(client);
    await client.executeMultiple(`
      INSERT INTO notices VALUES ('A', '000', '2026-01-01',
        '{"title":"공고","payload":{"dmItemMap":{"rgnLmtYn":"Y","prcmBsneSeNm":"기타"}}}',
        '{"fields":{"posted":"2026-01-01","searchTitle":"공고"},"regionOptions":["서울","서울"],"mock":1}');
      INSERT INTO g2b_collection_attempts (id, section, number, revision, opening_revision, input, started_at)
      VALUES (1,'notices','B','000','','{}','2026-01-01'), (2,'notices','B','000','','{}','2026-01-02');
    `);
    // 마이그레이션을 재실행해 이미 반영한 건수를 중복 적용하지 않는지 확인한다.
    await migrateG2bDatabase(client);
    const list = openNoticeList(new G2bDatabase(client));
    const query = { search: { field: "title", query: "" }, filters: {}, sort: "posted-desc", status: "total", page: 9 };
    const before = await list.page(query);
    assert.deepEqual(before.counts, { total: 2, collected: 1, uncollected: 1 });
    assert.equal(before.page, 1);
    assert.deepEqual(before.rows.map(({ number, id }) => [number, id]), [["A", null], ["B", 2]]);
    assert.deepEqual(await list.regions(), ["서울"]);
    assert.deepEqual(await list.regions({ excludeMockNotices: true }), []);
    assert.deepEqual((await list.page(query, { excludeMockNotices: true })).counts, { total: 1, collected: 0, uncollected: 1 });
    assert.equal((await list.page({ ...query, search: { field: "title", query: "공고" } })).counts.total, 1);
    // 최신 이력 삭제 시 이전 이력이 나타나고 마지막 원본 삭제 시 집계와 선택지가 비워진다.
    await client.execute("DELETE FROM g2b_collection_attempts WHERE id = 2");
    assert.equal((await list.page({ ...query, status: "uncollected" })).rows[0].id, 1);
    await client.executeMultiple("DELETE FROM notices; DELETE FROM g2b_collection_attempts;");
    assert.deepEqual((await list.page(query)).counts, { total: 0, collected: 0, uncollected: 0 });
    assert.deepEqual(await list.regions(), []);
  } finally {
    // 테스트 전용 연결을 닫는다.
    client.close();
  }
});

/** 기존 공고를 채울 때 선택지별 쓰임새와 기본 페이지 실행 계획을 검증한다. */
test("초기 데이터가 있으면 사용 건수를 보존하고 기본 페이지에 게시일 인덱스를 사용한다", async () => {
  // 이전 버전 원본에 해당하는 최소 테이블에 같은 지역의 공고 두 건을 넣는다.
  const client = createClient({ url: "file::memory:" });
  try {
    await client.executeMultiple(`
      CREATE TABLE notices (number TEXT, revision TEXT, collected_at TEXT, data TEXT, query_data TEXT, PRIMARY KEY(number, revision));
      CREATE TABLE g2b_collection_attempts (id INTEGER PRIMARY KEY, section TEXT, number TEXT, revision TEXT, opening_revision TEXT,
        started_at TEXT, status TEXT, error TEXT, diagnostics TEXT);
      CREATE INDEX attempts_target ON g2b_collection_attempts(section, number, revision, opening_revision, id DESC);
      INSERT INTO notices VALUES
        ('A','000','2026-01-01','{"payload":{"dmItemMap":{"rgnLmtYn":"Y"}}}','{"regionOptions":["서울","서울"],"mock":0}'),
        ('B','000','2026-01-02','{"payload":{"dmItemMap":{"rgnLmtYn":"Y"}}}','{"regionOptions":["서울"],"mock":0}');
      INSERT INTO g2b_collection_attempts VALUES (1,'notices','C','000','','2026-01-01','failed',NULL,NULL);
    `);
    // 운영과 동일한 초기화 SQL을 적용한 뒤 공고 하나를 지워도 공유 선택지가 남는다.
    await client.executeMultiple(noticeListSchema);
    await client.execute("DELETE FROM notices WHERE number = 'A'");
    const db = new G2bDatabase(client);
    const list = openNoticeList(db);
    assert.deepEqual(await list.regions({ excludeMockNotices: true }), ["서울"]);
    // 페이지가 실제로 실행하는 SQL에 설명을 붙여 관리자와 사용자 기본 목록 인덱스를 확인한다.
    const execute = db.execute.bind(db);
    const statements = [];
    db.execute = (statement) => {
      statements.push(statement);
      return execute(statement);
    };
    const query = { search: { field: "title", query: "" }, filters: {}, sort: "posted-desc", status: "total", page: 1 };
    assert.deepEqual((await list.page(query)).counts, { total: 2, collected: 1, uncollected: 1 });
    assert.equal((await list.page({ ...query, status: "collected" }, { excludeMockNotices: true })).rows[0].number, "B");
    for (const [statement, index] of statements.map((statement, position) => [statement, ["posted", "public"][position]])) {
      const result = await client.execute({ ...statement, sql: `EXPLAIN QUERY PLAN ${statement.sql}` });
      const explanation = result.rows.map(({ detail }) => detail).join("\n");
      assert.match(explanation, new RegExp(`USING INDEX g2b_notice_list_${index}`));
      assert.match(explanation, /SEARCH saved USING INDEX/);
      assert.match(explanation, /SEARCH attempt USING INTEGER PRIMARY KEY/);
    }
  } finally {
    // 테스트 전용 연결을 닫는다.
    client.close();
  }
});
