const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { openG2bRepository } = require("../src/server/g2b/repository/turso");

/** 저장 계약과 수집 시도의 키를 독립적으로 유지하고 선택지·집계와 함께 되돌리는지 검증한다. */
test("계약현황 목록의 복합 키, 최신 이력, 집계와 선택지를 유지한다", async () => {
  // 실제 마이그레이션을 거친 빈 저장소에서 저장 계약과 별도 개찰진행차수 이력을 구성한다.
  const client = createClient({ url: "file::memory:" });
  try {
    await migrateG2bDatabase(client);
    const db = new G2bDatabase(client);
    const { collectionAttempts: { contractList: list } } = openG2bRepository(db);
    const query = { search: { field: "title", query: "" }, filters: {}, sort: "date-desc", status: "total", page: 9 };
    assert.deepEqual((await list.page(query)).counts, { total: 0, collected: 0, uncollected: 0 });
    await client.executeMultiple(`
      INSERT INTO contracts VALUES ('A','000','2026-01-01','{}',
        '{"searchTitle":"검증 계약","fields":{"date":"2026-01-01","receipt":"req-1","businesses":[{"code":"01","label":"물품"}]}}');
      INSERT INTO g2b_collection_attempts (id, section, number, revision, opening_revision, input, started_at)
        VALUES (1,'contracts','A','000','','{}','2026-01-01'),
          (2,'contracts','A','000','','{}','2026-01-02'),
          (3,'contracts','A','000','001','{}','2026-01-03'),
          (4,'contracts','B','000','','{}','2026-01-04');
    `);
    // 마이그레이션을 다시 실행해도 저장·미저장 키와 선택지 사용 건수는 한 번만 반영된다.
    await migrateG2bDatabase(client);
    const countSql = "SELECT total, collected FROM g2b_collection_list_counts WHERE section='contracts' AND scope='all'";
    assert.deepEqual((await client.execute(countSql)).rows, [{ total: 3, collected: 1 }]);
    assert.deepEqual((await list.page(query)).rows.map(({ number, openingRevision, id }) => [number, openingRevision, id]),
      [["A", "", 2], ["A", "001", 3], ["B", "", 4]]);
    // 실제 저장소에서 업무구분 선택지를 읽는다.
    const businessOptions = await list.businesses();
    // 화면에 표시할 값과 순서를 검증한다.
    assert.deepEqual(businessOptions, [{ value: "01", label: "물품" }]);
    // 각 선택지가 React에 전달할 속성만 갖는지 확인한다.
    for (const option of businessOptions) {
      // libSQL의 숫자 인덱스와 길이 속성이 남아 있으면 실패한다.
      assert.deepEqual(Object.getOwnPropertyNames(option).sort(), ["label", "value"]);
    }
    assert.equal((await list.page({ ...query, search: { field: "number", query: "REQ-1" } })).counts.total, 1);

    // 기본 상태별 페이지가 공통 건수 한 행과 계약일자 인덱스를 사용하는지 확인한다.
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
      assert.match(plan, new RegExp(`USING INDEX g2b_contract_list_${index}`));
      assert.match(plan, /SEARCH saved USING INDEX/);
      assert.match(plan, /SEARCH attempt USING INTEGER PRIMARY KEY/);
    }

    // 최신 시도와 저장본을 차례로 지워 이전 시도·수집 상태·업무구분의 변화를 직접 확인한다.
    await db.transaction(async () => {
      await db.execute("DELETE FROM g2b_collection_attempts WHERE id = 2");
      assert.equal((await list.page(query)).rows[0].id, 1);
      // 같은 계약에서 중복된 업무구분 값은 하나의 선택지로 집계하고 이전 조합은 제거한다.
      await db.execute(`UPDATE contracts SET query_data = json_set(query_data, '$.fields.businesses',
        json('[{"code":"03","label":"용역"},{"code":"03","label":"용역"}]')) WHERE number = 'A'`);
      assert.deepEqual(await list.businesses(), [{ value: "03", label: "용역" }]);
      await db.execute("DELETE FROM contracts WHERE number = 'A'");
      assert.deepEqual((await db.execute(countSql)).rows, [{ total: 3, collected: 0 }]);
      assert.deepEqual(await list.businesses(), []);
      // 의도적으로 실패시켜 목록과 집계를 같은 트랜잭션에서 롤백한다.
      throw new Error("검증용 롤백");
    }).catch((error) => assert.equal(error.message, "검증용 롤백"));
    assert.deepEqual((await client.execute(countSql)).rows, [{ total: 3, collected: 1 }]);
    assert.deepEqual(await list.businesses(), [{ value: "01", label: "물품" }]);
    // 저장 자료가 없는 B의 마지막 시도가 삭제되면 목록 키와 전체 건수도 사라진다.
    await client.execute("DELETE FROM g2b_collection_attempts WHERE id = 4");
    assert.deepEqual((await list.page(query)).counts, { total: 2, collected: 1, uncollected: 1 });
  } finally {
    // 테스트 연결을 닫아 다른 테스트와 상태를 공유하지 않게 한다.
    client.close();
  }
});
