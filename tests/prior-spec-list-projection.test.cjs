const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { openG2bRepository } = require("../src/server/g2b/repository/turso");

/** 조회 불가 연결의 중복, 키 이동, 원본 저장·삭제 및 롤백 후 집계 정합성을 확인한다. */
test("사전규격 목록이 조회 불가 연결을 해당 미수집 키에만 적용한다", async () => {
  // 전체 마이그레이션을 적용한 테스트 연결에서 실제 목록 저장소를 연다.
  const client = createClient({ url: "file::memory:" });
  try {
    await migrateG2bDatabase(client);
    const db = new G2bDatabase(client);
    const { collectionAttempts: { priorSpecList: list } } = openG2bRepository(db);
    const query = { search: { field: "title", query: "" }, filters: {}, sort: "date-desc", status: "total", page: 1 };
    const countsSql = "SELECT total, collected FROM g2b_collection_list_counts WHERE section='prior-specs' AND scope='all'";
    // A의 기본 키와 별도 차수, B의 미수집 이력을 준비한다.
    await db.execute(`INSERT INTO g2b_collection_attempts (id,section,number,revision,opening_revision,input,started_at)
      VALUES (1,'prior-specs','A','','','{}','2026-01-01'), (2,'prior-specs','A','','','{}','2026-01-02'),
        (3,'prior-specs','A','','001','{}','2026-01-01'), (4,'prior-specs','B','','','{}','2026-01-01')`);
    const initial = (await db.execute(countsSql)).rows;
    assert.deepEqual(initial, [{ total: 3, collected: 0 }]);
    // 한 공고는 잘못된 기본 번호를 건너뛰고 대체 경로에서 A를 연결한다.
    await assert.rejects(db.transaction(async () => {
      await db.execute(`INSERT INTO notices VALUES
        ('N1','000','2026-01-01','{"priorSpecStatus":"unavailable","payload":{"dmItemMap":{"bfSpecRegNo":" A "},"dlBfSpecM":{"bfSpecRegNo":"B"}}}','{}'),
        ('N2','000','2026-01-01','{"priorSpecStatus":"unavailable","payload":{"dmItemMap":{"bfSpecRegNo":"bad"},"dlBfSpecM":{"bfSpecRegNo":"A"}}}','{}')`);
      assert.deepEqual((await list.page(query)).rows.map(({ number }) => number), ["B"]);
      // 중복 연결 하나를 제거해도 남은 연결 때문에 A는 계속 숨는다.
      await db.execute("DELETE FROM notices WHERE number = 'N1'");
      assert.deepEqual((await db.execute(countsSql)).rows, [{ total: 1, collected: 0 }]);
      // A를 저장하면 빈 차수의 저장 키만 다시 노출된다.
      await db.execute(`INSERT INTO prior_specs VALUES ('A','2026-01-01','{}',
        '{"fields":{"businesses":[{"code":"01","label":"물품"}]}}')`);
      await db.execute("DELETE FROM g2b_collection_attempts WHERE id = 2");
      assert.equal((await list.page(query)).rows[0].id, 1);
      assert.deepEqual((await db.execute(countsSql)).rows, [{ total: 2, collected: 1 }]);
      // 실제 저장소에서 업무구분 선택지를 읽는다.
      const businessOptions = await list.businesses();
      // 화면에 표시할 값과 순서를 검증한다.
      assert.deepEqual(businessOptions, [{ value: "01", label: "물품" }]);
      // 각 선택지가 React에 전달할 속성만 갖는지 확인한다.
      for (const option of businessOptions) {
        // libSQL의 숫자 인덱스와 길이 속성이 남아 있으면 실패한다.
        assert.deepEqual(Object.getOwnPropertyNames(option).sort(), ["label", "value"]);
      }
      // 저장본 삭제는 A 키를 다시 숨기고 마지막 업무구분 사용처를 없앤다.
      await db.execute("DELETE FROM prior_specs WHERE number = 'A'");
      assert.deepEqual(await list.businesses(), []);
      assert.deepEqual((await db.execute(countsSql)).rows, [{ total: 1, collected: 0 }]);
      // 마지막 연결을 B로 바꾸면 A의 두 키가 나타나고 B만 숨는다.
      await db.execute("UPDATE notices SET data = json_set(data, '$.payload.dlBfSpecM.bfSpecRegNo', 'B') WHERE number = 'N2'");
      assert.deepEqual((await list.page(query)).rows.map(({ number, id }) => [number, id]), [["A", 1], ["A", 3]]);
      assert.deepEqual((await db.execute(countsSql)).rows, [{ total: 2, collected: 0 }]);
      throw new Error("검증용 롤백");
    }), /검증용 롤백/);
    // 롤백 뒤 집계와 최신 이력을 확인하고 빈 사용자 선택지를 복원한다.
    assert.deepEqual((await db.execute(countsSql)).rows, initial);
    assert.deepEqual((await list.page(query)).rows.map(({ id }) => id), [2, 3, 4]);
    assert.deepEqual(await list.businesses(), []);
    // 데이터가 남은 상태에서 마이그레이션을 재실행해도 초기화가 중복되지 않는다.
    await migrateG2bDatabase(client);
    assert.deepEqual((await db.execute(countsSql)).rows, initial);

    // 실제 목록 SQL의 기본 건수와 정렬 경로가 각각 한 키와 상태별 인덱스를 사용하는지 확인한다.
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
      assert.match(plan, new RegExp(`USING INDEX g2b_prior_spec_list_${index}`));
    }
    // 공고 연결 변경이 전체 목록을 순회하지 않고 영향받는 번호를 키로 조회하는지 확인한다.
    const { rows: updatePlan } = await client.execute(`EXPLAIN QUERY PLAN UPDATE g2b_prior_spec_list SET visible = 0
      WHERE number = 'A' AND collected_at IS NULL AND visible = 1`);
    assert.match(updatePlan.map(({ detail }) => detail).join("\n"), /SEARCH g2b_prior_spec_list USING PRIMARY KEY \(number=\?\)/);
    const { rows: linkPlan } = await client.execute(`EXPLAIN QUERY PLAN SELECT 1
      FROM g2b_prior_spec_unavailable_links WHERE spec_number = 'A' LIMIT 1`);
    assert.match(linkPlan.map(({ detail }) => detail).join("\n"), /SEARCH .* USING COVERING INDEX g2b_prior_spec_unavailable_number/);
  } finally {
    // 테스트 연결을 반환한다.
    client.close();
  }
});
