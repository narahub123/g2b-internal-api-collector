const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { noticeListSchema } = require("../src/server/g2b/repository/notice-list-schema");
const { collectionListCountsSchema } = require("../src/server/g2b/repository/collection-list-counts-schema");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { openNoticeList } = require("../src/server/g2b/repository/notice-list");
const { appendCollectionDateRange } = require("../src/server/g2b/repository/collection-list-query");

/** 날짜 범위가 시각과 연도 경계에 관계없이 달력 날짜 전체를 포함하는지 확인한다. */
test("날짜 필터가 UTC 달력에서 종료일 다음 날을 상한으로 사용한다", () => {
  // 월말, 윤일, 연말과 지원하는 마지막 날짜의 다음 문자열 경계를 구성한다.
  const boundaries = [
    ["2024-02-28", "2024-02-29"],
    ["2024-02-29", "2024-03-01"],
    ["2026-01-31", "2026-02-01"],
    ["2026-12-31", "2027-01-01"],
    ["9999-12-31", "9999-12-32"],
  ];
  // 상한만 있는 필터는 종료일에 속한 일시만 포함할 수 있도록 배타적으로 비교한다.
  for (const [to, next] of boundaries) {
    // 다른 쿼리 조건과 인자 뒤에 날짜 상한이 붙는지 검증한다.
    const where = ["is_mock = ?"];
    const values = [0];
    // 검증된 종료일로 실제 저장소가 사용하는 범위 조건을 구성한다.
    appendCollectionDateRange(where, values, "posted", { to });
    // 바인딩 순서를 유지하면서 일시 열에 직접 상한을 적용해야 한다.
    assert.deepEqual(where, ["is_mock = ?", "posted < ?"]);
    assert.deepEqual(values, [0, next]);
  }
});

/** 기존 시도를 초기화하고 원본 변경에 따라 페이지와 선택지가 즉시 갱신되는지 검증한다. */
test("입찰공고 목록이 최신 시도, 정확한 집계 및 선택지를 유지한다", async () => {
  // 전체 마이그레이션을 적용한 메모리 DB에 저장 공고와 실패 이력을 구성한다.
  const client = createClient({ url: "file::memory:" });
  try {
    await migrateG2bDatabase(client);
    await client.executeMultiple(`
      INSERT INTO notices VALUES ('A', '000', '2026-01-01',
        '{"title":"공고","payload":{"dmItemMap":{"rgnLmtYn":"Y","prcmBsneSeNm":"기타"}}}',
        '{"fields":{"posted":"2026-01-01","submission":"2026-01-31 23:59:59","searchTitle":"공고","budget":0},"regionOptions":["서울","서울"],"mock":1}');
      INSERT INTO g2b_collection_attempts (id, section, number, revision, opening_revision, input, started_at)
      VALUES (1,'notices','B','000','','{}','2026-01-01'), (2,'notices','B','000','','{}','2026-01-02');
    `);
    // 마이그레이션을 재실행해 이미 반영한 건수를 중복 적용하지 않는지 확인한다.
    await migrateG2bDatabase(client);
    // 공통 집계의 두 범위와 이전 버전 조회의 호환 뷰가 같은 건수를 제공해야 한다.
    const countsSql = "SELECT scope, total, collected FROM g2b_collection_list_counts WHERE section = 'notices' ORDER BY scope";
    // 트랜잭션 전 값을 보관해 롤백 뒤 공통 테이블의 두 행을 직접 대조한다.
    const initialCounts = (await client.execute(countsSql)).rows;
    assert.deepEqual(initialCounts, [
      { scope: "all", total: 2, collected: 1 },
      { scope: "exclude_mock", total: 1, collected: 0 },
    ]);
    assert.deepEqual((await client.execute("SELECT * FROM g2b_notice_list_counts WHERE id = 1")).rows, [
      { id: 1, total: 2, collected: 1, public_total: 1, public_collected: 0 },
    ]);
    // 입찰공고 저장소와 실행 계획이 같은 메모리 DB를 사용한다.
    const db = new G2bDatabase(client);
    // 계측 중에도 원래 연결에서 쿼리를 실행하도록 바인딩한다.
    const execute = db.execute.bind(db);
    // 마지막 저장소 호출의 SQL과 인자를 실행 계획에 재사용한다.
    let lastStatement;
    /**
     * 저장소가 전달한 SQL과 인자를 기록한 뒤 원래 연결에서 실행한다.
     * @param {object} statement 실행할 SQL과 바인딩 인자.
     * @returns {Promise<object>} 원래 연결이 반환한 실행 결과.
     * @throws DB가 조회를 거부하면 호출자에게 오류를 전달한다.
     */
    db.execute = (statement) => {
      // 이 호출의 SQL을 보관한 뒤 평소대로 실행한다.
      lastStatement = statement;
      return execute(statement);
    };
    // 계측 연결로 입찰공고 목록 저장소를 연다.
    const list = openNoticeList(db);
    const query = { search: { field: "title", query: "" }, filters: {}, sort: "posted-desc", status: "total", page: 9 };
    const before = await list.page(query);
    assert.deepEqual(before.counts, { total: 2, collected: 1, uncollected: 1 });
    assert.equal(before.page, 1);
    assert.deepEqual(before.rows.map(({ number, id }) => [number, id]), [["A", null], ["B", 2]]);
    assert.deepEqual(await list.regions(), ["서울"]);
    assert.deepEqual(await list.regions({ excludeMockNotices: true }), []);
    assert.deepEqual((await list.page(query, { excludeMockNotices: true })).counts, { total: 1, collected: 0, uncollected: 1 });
    assert.equal((await list.page({ ...query, search: { field: "title", query: "공고" } })).counts.total, 1);
    // 게시일이 없는 미수집 행이 마지막에 남고 페이지 경계가 유지되는지 확인한다.
    assert.deepEqual(await list.page({ ...query, sort: "posted-asc" }), before);
    // 실제 조회와 같은 SQL과 인자로 실행 계획을 생성한다.
    const ascendingPlan = await client.execute({ ...lastStatement, sql: `EXPLAIN QUERY PLAN ${lastStatement.sql}` });
    // 페이지 키를 고르는 하위 계획에서 인덱스를 사용하고 별도 정렬을 피해야 한다.
    const paged = ascendingPlan.rows.find(({ detail }) => detail === "MATERIALIZE paged");
    assert.ok(paged);
    const candidatePlan = ascendingPlan.rows.filter(({ parent }) => parent === paged.id);
    assert.match(candidatePlan.map(({ detail }) => detail).join("\n"), /USING INDEX g2b_notice_list_posted_asc/);
    assert.doesNotMatch(candidatePlan.map(({ detail }) => detail).join("\n"), /TEMP B-TREE FOR ORDER BY/);
    // 종료일 마지막 시각까지 포함하고 날짜가 없는 미수집 공고는 제외해야 한다.
    const submissionRange = { from: "2026-01-31", to: "2026-01-31" };
    const filtered = await list.page({ ...query, filters: { submission: submissionRange } });
    assert.deepEqual(filtered.rows.map(({ number }) => number), ["A"]);
    assert.deepEqual(filtered.counts, { total: 1, collected: 1, uncollected: 0 });
    // 실제 조건이 제출 시작일 인덱스를 범위 조회에 사용해야 한다.
    const submissionPlan = await client.execute({ ...lastStatement, sql: `EXPLAIN QUERY PLAN ${lastStatement.sql}` });
    assert.ok(submissionPlan.rows.some(({ detail }) => /SEARCH .*g2b_notice_list_submission/.test(detail)));
    // 0원 경계를 포함하고 예산이 없는 행을 제외한 뒤 두 조회 경로의 실행 계획을 확인한다.
    const budget = await list.page({ ...query, filters: { budget: { from: 0, to: 0 } } });
    assert.deepEqual(budget.rows.map(({ number }) => number), ["A"]);
    const budgetPlan = await client.execute({ ...lastStatement, sql: `EXPLAIN QUERY PLAN ${lastStatement.sql}` });
    assert.ok(budgetPlan.rows.some(({ detail }) => /SEARCH g2b_notice_list USING (?:COVERING )?INDEX g2b_notice_list_budget/.test(detail)));
    assert.ok(budgetPlan.rows.some(({ detail }) => /USING INDEX g2b_notice_list_posted\b/.test(detail)));
    // 수집 여부와 모의공고 여부가 함께 바뀌는 양방향 전이를 같은 트랜잭션에서 검증한다.
    const transaction = await client.transaction("write");
    try {
      // 미수집 시도만 있던 B를 모의공고로 저장하면 전체 수집 건수는 늘고 사용자 전체 건수는 줄어든다.
      await transaction.execute("INSERT INTO notices VALUES ('B', '000', '2026-01-01', '{}', '{\"mock\":1}')");
      assert.deepEqual((await transaction.execute(countsSql)).rows, [
        { scope: "all", total: 2, collected: 2 },
        { scope: "exclude_mock", total: 0, collected: 0 },
      ]);
      // A가 일반 공고가 되면 사용자 범위의 전체 및 수집 건수가 함께 늘어난다.
      await transaction.execute("UPDATE notices SET query_data = json_set(query_data, '$.mock', 0) WHERE number = 'A'");
      assert.deepEqual((await transaction.execute("SELECT * FROM g2b_notice_list_counts")).rows, [
        { id: 1, total: 2, collected: 2, public_total: 1, public_collected: 1 },
      ]);
      // B의 저장 공고만 삭제하면 남은 시도가 미수집 대상으로 사용자 범위에 다시 포함된다.
      await transaction.execute("DELETE FROM notices WHERE number = 'B'");
      assert.deepEqual((await transaction.execute(countsSql)).rows, [
        { scope: "all", total: 2, collected: 1 },
        { scope: "exclude_mock", total: 2, collected: 1 },
      ]);
      // 모든 원본 변경과 집계 갱신을 함께 되돌린다.
      await transaction.rollback();
    } finally {
      // 검증에 사용한 트랜잭션 연결을 반환한다.
      transaction.close();
    }
    // 롤백 뒤 공통 테이블의 두 행과 사용자 목록이 시작 상태로 복구되는지 확인한다.
    assert.deepEqual((await client.execute(countsSql)).rows, initialCounts);
    assert.deepEqual((await list.page(query, { excludeMockNotices: true })).counts, { total: 1, collected: 0, uncollected: 1 });
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
    // 마이그레이션 20의 기존 집계와 이전 후 호환 뷰를 비교한다.
    await client.executeMultiple(noticeListSchema);
    const legacyQuery = "SELECT * FROM g2b_notice_list_counts WHERE id = 1";
    const before = (await client.execute(legacyQuery)).rows;
    await client.executeMultiple(collectionListCountsSchema);
    assert.deepEqual((await client.execute(legacyQuery)).rows, before);
    // 공고 하나를 지워도 같은 지역을 사용하는 다른 공고가 있으므로 선택지가 남는다.
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
      assert.match(explanation, /SEARCH g2b_collection_list_counts USING PRIMARY KEY \(section=\? AND scope=\?\)/);
      assert.match(explanation, new RegExp(`USING INDEX g2b_notice_list_${index}`));
      assert.match(explanation, /SEARCH saved USING INDEX/);
      assert.match(explanation, /SEARCH attempt USING INTEGER PRIMARY KEY/);
    }
  } finally {
    // 테스트 전용 연결을 닫는다.
    client.close();
  }
});
