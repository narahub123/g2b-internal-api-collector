const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { openNoticeList } = require("../src/server/g2b/repository/notice-list");

/** 빈 제목과 동률의 기존 순서를 보존하면서 양방향 제목 인덱스로 페이지 키를 읽는지 검증한다. */
test("제목 정렬은 빈값과 동률 순서를 보존한다", async () => {
  // 운영 데이터와 분리된 메모리 DB에 빈 스키마를 설치한다.
  const client = createClient({ url: "file::memory:" });
  try {
    // 첫 마이그레이션과 재실행 뒤에도 동일한 인덱스가 있어야 한다.
    await migrateG2bDatabase(client);
    await migrateG2bDatabase(client);
    // 표시 제목과 정렬 제목이 다르고, 동률과 빈값이 있는 공고를 저장한다.
    await client.execute(`INSERT INTO notices VALUES
      ('A','001','2026-11-22','{"title":"표시"}','{"fields":{"sortTitle":"가"}}'),
      ('A','000','2026-11-22','{"title":"표시"}','{"fields":{"sortTitle":"가"}}'),
      ('B','000','2026-11-22','{"title":"표시"}','{"fields":{"sortTitle":"나"}}'),
      ('C','000','2026-11-22','{"title":"표시"}','{"fields":{}}')`);
    // 같은 기본 번호에서 최신 수집 시도 전용 진행차수와 일반 공고 키를 함께 조회한다.
    await client.execute(`INSERT INTO g2b_collection_attempts(section,number,revision,opening_revision,input,started_at,status)
      VALUES ('notices','C','000','001','{}','2026-11-24','failed')`);
    // 저장소가 DB에 전달한 페이지 SQL을 설명 쿼리에 재사용한다.
    const db = new G2bDatabase(client);
    const execute = db.execute.bind(db);
    let statement;

    /**
     * 마지막 페이지 SQL을 저장한 다음 원래 연결에서 실행한다.
     * @param {object} query 페이지 조회 SQL과 바인딩.
     * @returns {Promise<object>} DB의 원본 조회 결과.
     */
    db.execute = (query) => {
      // 저장소의 실제 실행문을 보존한다.
      statement = query;
      // 기존 연결 경로의 결과를 호출자에게 전달한다.
      return execute(query);
    };
    // 전체 상태의 제목 양방향에서 NULL은 마지막이며 동률 키 순서는 같다.
    const list = openNoticeList(db);
    const query = { search: { field: "title", query: "" }, filters: {}, status: "total", page: 1 };
    // 두 정렬 방향에서 결과 순서와 후보 접근 계획을 각각 확인한다.
    for (const [direction, expected] of [
      ["asc", ["A:000:", "A:001:", "B:000:", "C:000:", "C:000:001"]],
      ["desc", ["B:000:", "A:000:", "A:001:", "C:000:", "C:000:001"]],
    ]) {
      // 저장소 결과에서 복합 키 순서를 확인한다.
      const result = await list.page({ ...query, sort: "title-" + direction });
      assert.deepEqual(result.rows.map(row => [row.number, row.revision, row.openingRevision].join(":")), expected);
      // 후보는 해당 방향의 인덱스로 읽어야 한다.
      const plan = await client.execute({ ...statement, sql: "EXPLAIN QUERY PLAN " + statement.sql });
      const details = plan.rows.map(({ detail }) => detail);
      const candidateEnd = details.findIndex(detail => detail === "SCAN paged LEFT-JOIN");
      assert.ok(candidateEnd > 0);
      assert.ok(details.slice(0, candidateEnd).some(detail => detail.includes("g2b_notice_list_title_" + direction)));
      assert.ok(!details.slice(0, candidateEnd).some(detail => detail.includes("TEMP B-TREE FOR ORDER BY")));
    }
    // 미수집 요청은 기존 상태별 인덱스로 희소한 행을 찾는다.
    const uncollected = await list.page({ ...query, sort: "title-asc", status: "uncollected" });
    assert.deepEqual(uncollected.rows.map(({ openingRevision }) => openingRevision), ["001"]);
    const plan = await client.execute({ ...statement, sql: "EXPLAIN QUERY PLAN " + statement.sql });
    assert.ok(plan.rows.some(({ detail }) => detail.includes("g2b_notice_list_uncollected")));
  } finally {
    // 테스트용 연결을 닫는다.
    client.close();
  }
});
