const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { openNoticeList } = require("../src/server/g2b/repository/notice-list");

/** 날짜 없는 행이 많은 경우에도 중간 페이지와 날짜 경계에서 기존 정렬과 전체 건수를 유지하는지 확인한다. */
test("입찰공고 깊은 오름차순 페이지는 날짜 경계와 빈 날짜의 순서를 보존한다", async () => {
  // 운영과 분리된 메모리 DB에 마이그레이션과 실제 저장소를 준비한다.
  const client = createClient({ url: "file::memory:" });
  try {
    // 첫 실행과 재실행이 모두 가능한지 확인한다.
    await migrateG2bDatabase(client);
    await migrateG2bDatabase(client);
    // 날짜가 있는 행과 없는 행을 섞고, 페이지가 정확히 15건으로 나뉘는 데이터를 만든다.
    await client.execute(`WITH RECURSIVE keys(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM keys WHERE i<4500)
      INSERT INTO notices SELECT printf('PAGE%05d', i), '000', '2026-11-22', '{}',
        json_object('fields', json_object('posted', CASE WHEN i<=2030 THEN
          datetime('2026-11-01', '+' || (i / 3) || ' minutes') END)) FROM keys`);
    // 실제 목록 쿼리를 기록해 날짜 하한 탐색을 확인한다.
    const db = new G2bDatabase(client);
    const execute = db.execute.bind(db);
    let statement;

    /**
     * 실행 계획 확인에 사용할 쿼리를 보관하고 원래 DB 실행 결과를 반환한다.
     * @param {object} query 저장소의 SQL과 바인딩.
     * @returns {Promise<object>} 원래 DB에서 반환한 결과.
     */
    db.execute = (query) => {
      // 페이지 SQL을 별도로 설명할 수 있도록 마지막 쿼리를 저장한다.
      statement = query;
      // 애플리케이션이 사용하는 실제 실행 경로에서 결과를 가져온다.
      return execute(query);
    };
    // 상태나 검색 조건이 없는 날짜 오름차순의 직접 페이지 이동을 요청한다.
    const list = openNoticeList(db);
    const params = { search: { field: "number", query: "" }, filters: {}, sort: "posted-asc", status: "total" };
    // 날짜가 있는 페이지, 날짜와 빈값이 걸친 페이지, 빈값 페이지, 마지막 및 범위 초과를 확인한다.
    for (const page of [1, 130, 136, 137, 150, 151, 299, 300, 999]) {
      // 저장소 결과를 페이지 구간의 기존 기준 순서와 대조한다.
      const result = await list.page({ ...params, page });
      const first = (Math.min(page, 300) - 1) * 15 + 1;
      const expected = Array.from({ length: 15 }, (_, index) => "PAGE" + String(first + index).padStart(5, "0"));
      assert.deepEqual(result.rows.map(({ number }) => number), expected);
      assert.deepEqual(result.counts, { total: 4500, collected: 4500, uncollected: 0 });
      assert.equal(result.page, Math.min(page, 300));
      assert.equal(result.totalPages, 300);
      // 날짜가 있는 깊은 페이지는 기존 날짜 인덱스를 하한으로 탐색한다.
      if (page === 130) {
        const plan = await client.execute({ ...statement, sql: "EXPLAIN QUERY PLAN " + statement.sql });
        assert.match(plan.rows.map(({ detail }) => detail).join("\n"), /SEARCH g2b_notice_list USING INDEX g2b_notice_list_posted_asc .*posted>\?/);
      }
    }
    // 빈 목록에서는 요청 페이지가 1로 돌아가고 표시할 행이 없다.
    await client.execute("DELETE FROM notices");
    const empty = await list.page({ ...params, page: 999 });
    assert.equal(empty.page, 1);
    assert.equal(empty.totalPages, 0);
    assert.deepEqual(empty.rows, []);
  } finally {
    // 검증에 사용한 연결을 정리한다.
    client.close();
  }
});

