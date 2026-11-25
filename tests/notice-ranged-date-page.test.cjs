const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { openNoticeList } = require("../src/server/g2b/repository/notice-list");

/** 날짜 구간 집계와 깊은 페이지가 동일한 범위와 복합 키 순서를 쓰는지 검증한다. */
test("날짜 구간의 범위·수집 건수·페이지 경계를 유지한다", async () => {
  // 운영과 분리한 메모리 DB에서 최초 설치와 재실행을 실행한다.
  const client = createClient({ url: "file::memory:" });
  try {
    // 초기화된 스키마와 타임스탬프·NULL이 섞인 목록을 준비한다.
    await migrateG2bDatabase(client);
    await migrateG2bDatabase(client);
    await client.execute(`WITH RECURSIVE ids(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM ids WHERE i<1600)
      INSERT INTO notices SELECT printf('RANGE%04d',i),'000','2026-11-25','{}',
        json_object('fields',json_object('posted',CASE WHEN i<1600 THEN
          datetime('2026-11-01','+'||(i/3*8)||' minutes') END))
      FROM ids`);
    // 실제 목록 저장소와 사용자가 넘기는 기존 달력일 범위를 사용한다.
    const db = new G2bDatabase(client);
    const list = openNoticeList(db);
    const query = { filters: { posted: { from: "2026-11-02", to: "2026-11-03" } },
      search: { field: "title", query: "" }, sort: "posted-asc", status: "total", page: 65 };
    // 구간 경계가 포함된 실제 범위를 기존 목록 열에서 직접 세어 기준 결과를 만든다.
    const condition = "posted >= '2026-11-02' AND posted < '2026-11-04'";
    const { rows } = await client.execute(`SELECT number FROM g2b_notice_list WHERE ${condition}
      ORDER BY (posted IS NULL), posted, number, revision, opening_revision`);
    const page = await list.page(query);
    assert.deepEqual(page.counts, { total: rows.length, collected: rows.length, uncollected: 0 });
    assert.deepEqual(page.rows.map(({number})=>number), rows.slice(960,975).map(({number})=>number));
    // 날짜가 다른 구간으로 바뀌면 전체 건수와 수집 건수가 함께 이동한다.
    await assert.rejects(db.transaction(async () => {
      // 기존 시간 구간을 벗어나는 임시 변경을 트랜잭션 안에서 확인한다.
      await db.execute("UPDATE notices SET query_data=json_set(query_data,'$.fields.posted','2026-11-05') WHERE number='RANGE0970'");
      const updated = await list.page(query);
      assert.deepEqual(updated.counts, { total: rows.length-1, collected: rows.length-1, uncollected: 0 });
      throw new Error("구간 롤백");
    }), /구간 롤백/);
    // 롤백으로 날짜와 집계와 페이지가 모두 원복되는지 확인한다.
    assert.deepEqual(await list.page(query), page);
    // 종료일만 있는 범위에서도 이를 다음 날의 배타적 상한으로 처리한다.
    const upper = await list.page({ ...query, filters: { posted: { to: "2026-11-02" } }, page: 99999 });
    const prior = await client.execute("SELECT COUNT(*) AS total FROM g2b_notice_list WHERE posted < '2026-11-03'");
    assert.equal(upper.counts.total, prior.rows[0].total);
    assert.equal(upper.page, upper.totalPages);
  } finally {
    // 테스트 연결을 닫는다.
    client.close();
  }
});
