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

/** 조각 인덱스가 번호·차수 부분 일치와 다른 공개 범위를 보존하는지 확인한다. */
test("희소한 번호 조각은 같은 스냅샷에서 공고 목록 후보를 찾는다", async () => {
  // 파일이나 운영 데이터 없이 실제 트리거를 적용할 메모리 DB를 연다.
  const client = createClient({ url: "file::memory:" });
  try {
    // 검색 후보 한도가 두 건이 되도록 일반 공고와 하나뿐인 모의공고를 저장한다.
    await migrateG2bDatabase(client);
    await client.execute(`WITH RECURSIVE keys(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM keys WHERE i<200)
      INSERT INTO notices SELECT printf('COMMON%04d', i), '000', '2026-01-01', '{}', '{"fields":{"regions":["일반"]}}' FROM keys`);
    await client.execute("INSERT INTO notices VALUES ('SPECIALXYZ','070','2026-01-01','{}','{\"mock\":1}')");
    // 조각 탐색 이후 실제 페이지 SQL을 확인할 수 있도록 마지막 호출을 기록한다.
    const db = new G2bDatabase(client);
    const execute = db.execute.bind(db);
    let statement;
    /**
     * 실행 계획 대조를 위해 실제 목록 SQL을 기록하고 같은 DB에서 실행한다.
     * @param {object} query SQL과 바인딩 인자.
     * @returns {Promise<object>} 원래 연결의 결과.
     */
    db.execute = (query) => {
      // 마지막 SQL을 보관하고 정상 조회 흐름으로 넘긴다.
      statement = query;
      return execute(query);
    };
    // 번호와 차수 경계를 넘는 입력을 기존처럼 정규화하여 검색한다.
    const list = openNoticeList(db);
    const request = { search: { field: "number", query: "xYz/0-7" }, filters: {}, sort: "posted-desc", status: "total", page: 30 };
    const admin = await list.page(request);
    assert.deepEqual(admin.rows.map(({ number, revision }) => [number, revision]), [["SPECIALXYZ", "070"]]);
    assert.equal(admin.page, 1);
    // 조각 인덱스와 목록의 복합 기본 키를 사용했는지 검증한다.
    const plan = await client.execute({ ...statement, sql: `EXPLAIN QUERY PLAN ${statement.sql}` });
    const details = plan.rows.map(({ detail }) => detail).join("\n");
    assert.match(details, /SEARCH g2b_number_search_grams USING PRIMARY KEY/);
    assert.match(details, /SEARCH listed USING PRIMARY KEY/);
    // 목록에 저장한 기관명 조각은 배열의 항목별로 검색할 수 있어야 한다.
    await client.execute(`UPDATE notices SET query_data = json_set(query_data,'$.fields.agencies',json_array('서울한빛교통센터','한빛교통본부')) WHERE number = 'SPECIALXYZ'`);
    const agency = await list.page({ ...request, search: { field: "agency", query: "한빛교통" } });
    assert.equal(agency.counts.total, 1);
    const agencyPlan = await client.execute({ ...statement, sql: `EXPLAIN QUERY PLAN ${statement.sql}` });
    assert.match(agencyPlan.rows.map(({detail}) => detail).join("\n"), /SEARCH g2b_number_search_grams USING PRIMARY KEY/);
    // 제목 변경이 기관 조각을 삭제하지 않는지 삭제 감시 트리거와 실제 원본 갱신으로 확인한다.
    await client.executeMultiple(`CREATE TRIGGER assert_agency_unchanged BEFORE DELETE ON g2b_number_search_grams
      WHEN OLD.source = 4 BEGIN SELECT RAISE(ABORT, '기관 조각을 삭제함'); END;
      UPDATE notices SET query_data = json_set(query_data,'$.fields.searchTitle','한빛설계용역') WHERE number = 'SPECIALXYZ';
      DROP TRIGGER assert_agency_unchanged;`);
    const titled = await list.page({ ...request, search: { field: "title", query: "설계용역" } });
    assert.equal(titled.counts.total, 1);
    // 두 기관명을 이어 붙여야만 일치하는 검색어는 기관 배열에서 찾을 수 없다.
    const acrossAgencies = await list.page({ ...request, search: { field: "agency", query: "센터한빛" } });
    assert.equal(acrossAgencies.counts.total, 0);
    // 같은 후보라도 사용자 목록의 모의공고 제외 조건은 적용되어야 한다.
    const publicPage = await list.page(request, { excludeMockNotices: true });
    assert.deepEqual(publicPage.counts, { total: 0, collected: 0, uncollected: 0 });
    assert.deepEqual(publicPage.rows, []);
    // 중복 지역을 가진 공고와 명시적으로 제한 없는 공고를 각각 한 건만 반환한다.
    await client.executeMultiple(`
      UPDATE notices SET query_data = json_set(query_data,'$.fields.regions',json_array('서울','서울','경기')) WHERE number = 'SPECIALXYZ';
      UPDATE notices SET query_data = json_set(query_data,'$.fields.unrestrictedRegion',json('true')) WHERE number = 'COMMON0001';
    `);
    const region = { ...request, search: { field: "title", query: "" }, filters: { region: ["서울", "경기"] } };
    const regional = await list.page(region);
    assert.deepEqual(regional.rows.map(({ number }) => number), ["COMMON0001", "SPECIALXYZ"]);
    assert.equal(regional.counts.total, 2);
    // 작은 후보 집합을 기존 건수와 페이지에서 공유해야 한다.
    assert.match(statement.sql, /regional_keys AS MATERIALIZED/);
    // 흔한 지역은 제한된 탐색을 마친 뒤 기존 페이지 조회로 돌아간다.
    const broad = await list.page({ ...region, filters: { region: ["일반"] } });
    assert.equal(broad.counts.total, 200);
    assert.doesNotMatch(statement.sql, /regional_keys AS MATERIALIZED/);
    // 지역 갱신과 롤백이 원본과 함께 매핑에 반영되어야 한다.
    await assert.rejects(db.transaction(async () => {
      // 지역을 교체하면 기존 후보에서는 새 지역의 공고를 제외한다.
      await db.execute(`UPDATE notices SET query_data = json_set(query_data,'$.fields.regions',json_array('부산'))
        WHERE number = 'SPECIALXYZ'`);
      assert.deepEqual((await list.page(region)).rows.map(({number}) => number), ["COMMON0001"]);
      throw new Error("지역 변경 롤백");
    }), /지역 변경 롤백/);
    // 실패한 변경 뒤에는 지역 후보와 공개 범위가 모두 복원돼야 한다.
    assert.deepEqual(await list.page(region), regional);
    const visibleRegion = await list.page(region, { excludeMockNotices: true });
    assert.deepEqual(visibleRegion.rows.map(({number}) => number), ["COMMON0001"]);
    // 목록 키와 조각을 바꾼 쓰기 트랜잭션이 실패하면 두 데이터가 함께 복원되어야 한다.
    await assert.rejects(db.transaction(async () => {
      // 트랜잭션 안에서는 새 목록 키로 검색할 수 있다.
      await db.execute("UPDATE g2b_notice_list SET number = 'REPLACED' WHERE number = 'SPECIALXYZ'");
      assert.deepEqual((await list.page(request)).rows, []);
      throw new Error("번호 키 변경 롤백");
    }), /번호 키 변경 롤백/);
    // 롤백 후 검색 결과와 키 인덱스가 원래 상태여야 한다.
    assert.deepEqual(await list.page(request), admin);
  } finally {
    // 테스트 연결을 반환한다.
    client.close();
  }
});

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
        '{"fields":{"posted":"2026-01-01","submission":"2026-01-31 23:59:59","searchTitle":"공고","budget":0,"regions":["서울"]},"regionOptions":["서울","서울"],"mock":1}');
      INSERT INTO g2b_collection_attempts (id, section, number, revision, opening_revision, input, started_at)
      VALUES (1,'notices','B','000','','{}','2026-01-01'), (2,'notices','B','000','','{}','2026-01-02');
    `);
    // 마이그레이션을 재실행해 이미 반영한 건수를 중복 적용하지 않는지 확인한다.
    await migrateG2bDatabase(client);
    // 같은 번호·차수의 반복 세 글자는 한 번만 유지한다.
    const grams = await client.execute("SELECT gram FROM g2b_number_search_grams WHERE number = 'A' ORDER BY gram");
    assert.deepEqual(grams.rows, [{ gram: "000" }, { gram: "a00" }]);
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
      // 복합 키 변경 시 이전 조각을 지우고 새 키를 인덱싱한다.
      await transaction.execute("UPDATE g2b_notice_list SET number = 'CHANGED' WHERE number = 'A'");
      assert.equal((await transaction.execute("SELECT DISTINCT number FROM g2b_number_search_grams WHERE gram = 'ged'")).rows[0].number, "CHANGED");
      assert.deepEqual((await transaction.execute("SELECT gram FROM g2b_number_search_grams WHERE number = 'A'")).rows, []);
      // 뒤에 이어질 상태 전이 검증을 위해 목록 키를 복구한다.
      await transaction.execute("UPDATE g2b_notice_list SET number = 'A' WHERE number = 'CHANGED'");
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
    // 원본과 수집 이력이 사라진 키는 검색 인덱스에서도 제거돼야 한다.
    assert.deepEqual((await client.execute("SELECT gram FROM g2b_number_search_grams")).rows, []);
    // 원본 삭제가 끝나면 해당 지역 매핑도 남지 않아야 한다.
    assert.deepEqual((await client.execute("SELECT number FROM g2b_notice_region_keys")).rows, []);
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
