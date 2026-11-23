const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { openG2bRepository } = require("../src/server/g2b/repository/turso");

/** 동일한 업무구분을 가진 행의 수집 여부만 바꿔 선택지와 사용 건수를 검증한다. */
test("개찰결과 업무구분은 수집된 진행차수만 한 번씩 센다", async () => {
  // 공통 스키마를 적용한 독립 DB에서 표시 선택지와 내부 집계를 함께 확인한다.
  const client = createClient({ url: "file::memory:" });
  try {
    await migrateG2bDatabase(client);
    const db = new G2bDatabase(client);
    const list = openG2bRepository(db).collectionAttempts.openingResultList;
    const goods = JSON.stringify({ businesses: [{ code: "01", label: "물품" }, { code: "01", label: "물품" }] });
    const services = JSON.stringify({ businesses: [{ code: "03", label: "용역" }] });

    /**
     * 표시 목록과 조합별 사용 건수를 동일한 기대값으로 대조한다.
     * @param expected 값·라벨·사용 건수 순으로 구성한 기대 조합 목록.
     */
    async function verify(expected) {
      // 사용 건수는 조합별로 읽고 화면 선택지는 기존 반환형으로 비교한다.
      const { rows } = await db.execute("SELECT pair, uses FROM g2b_opening_result_list_businesses ORDER BY pair");
      assert.deepEqual(rows.map(({ pair, uses }) => [...JSON.parse(pair), uses]), expected);
      assert.deepEqual(await list.businesses(), expected.map(([value, label]) => ({ value, label })));
    }

    // 두 미수집 키가 동일한 업무구분을 가지고 있어도 기여하지 않는다.
    await db.execute({ sql: `INSERT INTO g2b_opening_result_list(number,revision,opening_revision,fields)
      VALUES ('A','000','001',?), ('A','000','002',?)`, args: [goods, goods] });
    await verify([]);
    // 업무구분 필드를 수정하지 않고 수집할 때 진행차수별로 한 번만 센다.
    await db.execute("UPDATE g2b_opening_result_list SET collected_at='2026-01-01' WHERE number='A'");
    await verify([["01", "물품", 2]]);
    // 첫 차수를 미수집으로 돌리면 공유 선택지는 한 건의 사용처를 유지한다.
    await db.execute("UPDATE g2b_opening_result_list SET collected_at=NULL WHERE opening_revision='001'");
    await verify([["01", "물품", 1]]);
    // 미수집 행의 업무구분만 바뀌어도 선택지에는 영향을 주지 않는다.
    await db.execute({ sql: "UPDATE g2b_opening_result_list SET fields=? WHERE opening_revision='001'", args: [services] });
    await verify([["01", "물품", 1]]);
    // 수집 상태에서 업무가 바뀌면 마지막 기존 선택지를 제거하고 새 조합을 추가한다.
    await db.execute({ sql: "UPDATE g2b_opening_result_list SET fields=? WHERE opening_revision='002'", args: [services] });
    await verify([["03", "용역", 1]]);
    // 롤백 내부에서 공유 선택지가 단계적으로 제거되고 롤백 뒤에는 이전 값으로 돌아온다.
    await assert.rejects(db.transaction(async () => {
      await db.execute("UPDATE g2b_opening_result_list SET collected_at='2026-01-01' WHERE opening_revision='001'");
      await verify([["03", "용역", 2]]);
      await db.execute("DELETE FROM g2b_opening_result_list WHERE opening_revision='001'");
      await verify([["03", "용역", 1]]);
      await db.execute("DELETE FROM g2b_opening_result_list WHERE opening_revision='002'");
      await verify([]);
      throw new Error("검증용 롤백");
    }), /검증용 롤백/);
    await verify([["03", "용역", 1]]);
  } finally {
    // 테스트 DB 연결을 반환한다.
    client.close();
  }
});

/** 연결 공고가 바뀔 때 같은 공고 차수의 저장 결과만 갱신되고 집계가 정합한지 검증한다. */
test("개찰결과 목록은 연결 공고 변경과 롤백을 차수별로 반영한다", async () => {
  // 실제 마이그레이션을 적용한 독립 DB에서 저장 결과와 시도 전용 키를 구성한다.
  const client = createClient({ url: "file::memory:" });
  try {
    await migrateG2bDatabase(client);
    const db = new G2bDatabase(client);
    const list = openG2bRepository(db).collectionAttempts.openingResultList;
    const query = { search: { field: "title", query: "" }, filters: {}, sort: "date-desc", status: "total", page: 1 };
    const countsSql = "SELECT total, collected FROM g2b_collection_list_counts WHERE section='opening-results' AND scope='all'";
    await db.execute(`INSERT INTO opening_results
      SELECT 'A', revision, opening, '2026-01-01', '{}',
        json_object('searchTitle','원본 결과','fields',json_object('date','2026-01-01',
          'agencies', json(agencies), 'businesses',json_array(json_object('code','01','label','물품'))))
      FROM (SELECT '000' AS revision,'001' AS opening,'[]' AS agencies
        UNION ALL SELECT '000','002','["원본기관"]' UNION ALL SELECT '001','001','[]')`);
    await db.execute(`INSERT INTO g2b_collection_attempts(id,section,number,revision,opening_revision,input,started_at)
      VALUES (1,'opening-results','A','000','001','{}','2026-01-01'),
        (2,'opening-results','A','000','001','{}','2026-01-02'),
        (3,'opening-results','A','000','003','{}','2026-01-01')`);
    const initial = (await db.execute(countsSql)).rows;
    assert.deepEqual(initial, [{ total: 4, collected: 3 }]);
    // 같은 공고 번호·차수의 저장 결과만 연결값을 사용하며 시도 전용 키의 건수는 유지한다.
    await assert.rejects(db.transaction(async () => {
      await db.execute(`INSERT INTO notices VALUES ('A','000','2026-01-01','{"title":"연결 공고"}',
        '{"openingSearchTitle":"연결 공고","linkedCode":"03","linkedAgency":"연결기관","linkedBusiness":[{"code":"03","label":"용역"}]}')`);
      const linked = await list.page({ ...query, search: { field: "title", query: "연결" } });
      assert.deepEqual(linked.rows.map(({ openingRevision, title }) => [openingRevision, title]),
        [["001", "연결 공고"], ["002", "연결 공고"]]);
      assert.equal((await list.page({ ...query, search: { field: "agency", query: "연결기관" } })).counts.total, 1);
      assert.equal((await list.page({ ...query, filters: { business: ["03"] } })).counts.total, 2);
      assert.deepEqual(await list.businesses(), [{ value: "01", label: "물품" }, { value: "03", label: "용역" }]);
      assert.deepEqual((await db.execute(countsSql)).rows, initial);
      // 공고 갱신은 연결된 결과의 검색값만 바꾸고 공고 삭제는 결과 자체의 선택지를 복구한다.
      await db.execute("UPDATE notices SET query_data = json_set(query_data, '$.openingSearchTitle', '갱신 공고') WHERE number = 'A'");
      assert.equal((await list.page({ ...query, search: { field: "title", query: "갱신" } })).counts.total, 2);
      // 공고에 코드가 없으면 단일 결과 코드가 공고의 명칭보다 우선한다.
      await db.execute(`UPDATE opening_results SET query_data = json_set(query_data, '$.singleBusiness',
        json('[{"code":"01","label":"물품"}]')) WHERE revision = '000' AND opening_revision = '001'`);
      await db.execute("UPDATE notices SET query_data = json_remove(query_data, '$.linkedCode') WHERE number = 'A'");
      assert.equal((await list.page({ ...query, filters: { business: ["03"] } })).counts.total, 1);
      // 원본 JSON을 사용할 수 없으면 공고 행이 남아 있어도 연결값을 적용하지 않는다.
      await db.execute("UPDATE notices SET data = '{' WHERE number = 'A'");
      assert.equal((await list.page({ ...query, search: { field: "title", query: "원본" } })).counts.total, 3);
      await db.execute(`UPDATE notices SET data = '{"title":"연결 공고"}' WHERE number = 'A'`);
      assert.equal((await list.page({ ...query, search: { field: "title", query: "갱신" } })).counts.total, 2);
      await db.execute("DELETE FROM notices WHERE number = 'A'");
      assert.deepEqual(await list.businesses(), [{ value: "01", label: "물품" }]);
      assert.equal((await list.page({ ...query, search: { field: "title", query: "원본" } })).counts.total, 3);
      // 저장 결과를 삭제해도 수집 시도가 남으면 같은 키가 미수집으로 전환된다.
      await db.execute("DELETE FROM opening_results WHERE number = 'A' AND revision = '000' AND opening_revision = '001'");
      await db.execute("DELETE FROM g2b_collection_attempts WHERE id = 2");
      const pending = await list.page({ ...query, status: "uncollected" });
      assert.deepEqual(pending.rows.map(({ id }) => id), [1, 3]);
      assert.deepEqual((await db.execute(countsSql)).rows, [{ total: 4, collected: 2 }]);
      throw new Error("검증용 롤백");
    }), /검증용 롤백/);
    // 이전 키와 최신 이력 및 공통 집계가 롤백 후 복원되고 재마이그레이션에도 유지된다.
    await migrateG2bDatabase(client);
    assert.deepEqual((await db.execute(countsSql)).rows, initial);
    assert.equal((await list.page(query)).rows[0].id, 2);
    // 실제 페이지 SQL과 공고 변경의 대상 조회가 관련 키의 인덱스를 사용하는지 확인한다.
    const execute = db.execute.bind(db);
    const statements = [];
    db.execute = (statement) => {
      statements.push(statement);
      return execute(statement);
    };
    for (const status of ["total", "collected", "uncollected"]) await list.page({ ...query, status });
    db.execute = execute;
    for (const [position, index] of ["date", "collected", "uncollected"].entries()) {
      const { sql, args } = statements[position];
      const { rows } = await client.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args });
      const plan = rows.map(({ detail }) => detail).join("\n");
      assert.match(plan, /SEARCH g2b_collection_list_counts USING PRIMARY KEY/);
      assert.match(plan, new RegExp(`USING INDEX g2b_opening_result_list_${index}`));
      assert.match(plan, /SEARCH result USING INDEX/);
      assert.match(plan, /SEARCH notice USING INDEX/);
    }
    const { rows: refreshPlan } = await client.execute(`EXPLAIN QUERY PLAN SELECT number, revision, opening_revision
      FROM opening_results WHERE number = 'A' AND revision = '000'`);
    assert.match(refreshPlan.map(({ detail }) => detail).join("\n"), /SEARCH opening_results USING COVERING INDEX .*\(number=\? AND revision=\?\)/);
  } finally {
    // 테스트 연결을 반환한다.
    client.close();
  }
});
