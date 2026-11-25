const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { openNoticeList } = require("../src/server/g2b/repository/notice-list");

/** 날짜가 없는 미수집 키의 페이지 경계와 수집 상태 전환이 기존 결과 순서를 보존하는지 확인한다. */
test("미수집 날짜순은 빈 날짜의 복합 키 순서와 상태 전환을 유지한다", async () => {
  // 운영과 분리한 빈 메모리 DB에서 최초 설치와 마이그레이션 재실행을 검증한다.
  const client = createClient({ url: "file::memory:" });
  try {
    // 스키마와 목록 저장소를 실제 경로로 연다.
    await migrateG2bDatabase(client);
    await migrateG2bDatabase(client);
    const list = openNoticeList(new G2bDatabase(client));
    // 검색이나 필터 없이 미수집 기본 날짜 오름차순을 읽는다.
    const query = { filters: {}, search: { field: "title", query: "" }, sort: "posted-asc", status: "uncollected", page: 1 };
    // 빈 목록 요청은 페이지 1과 전체 페이지 0을 반환한다.
    assert.deepEqual(await list.page(query), { counts: { total: 0, collected: 0, uncollected: 0 }, page: 1, totalPages: 0, rows: [] });
    // 날짜가 모두 없는 미수집 키를 17개 만들어 동률이 페이지 경계를 가로지르게 한다.
    await client.execute(`WITH RECURSIVE ids(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM ids WHERE i<17)
      INSERT INTO g2b_collection_attempts(section,number,revision,opening_revision,input,started_at,status)
      SELECT 'notices',printf('PAGE%02d',i),'000','','{}','2026-11-25','failed' FROM ids`);
    // 범위 초과 요청은 정렬된 마지막 두 행이 있는 두 번째 페이지로 보정된다.
    const last = await list.page({ ...query, page: 99999 });
    assert.equal(last.page, 2);
    assert.deepEqual(last.rows.map(({ number }) => number), ["PAGE16", "PAGE17"]);
    // 원본 수집이 저장되면 첫 번째 키가 미수집 인덱스에서 빠져 다음 키가 앞으로 이동한다.
    await client.execute(`INSERT INTO notices VALUES ('PAGE01','000','2026-11-25','{}','{"fields":{"posted":"2026-11-25"}}')`);
    const collected = await list.page(query);
    assert.deepEqual(collected.counts, { total: 17, collected: 1, uncollected: 16 });
    assert.equal(collected.rows[0].number, "PAGE02");
    // 미수집 키 삭제 후 기존 범위 초과 페이지가 첫 페이지로 보정된다.
    await client.execute("DELETE FROM g2b_collection_attempts WHERE section='notices' AND number='PAGE17'");
    const afterDelete = await list.page({ ...query, page: 99 });
    assert.equal(afterDelete.page, 1);
    assert.equal(afterDelete.totalPages, 1);
    assert.equal(afterDelete.rows.at(-1).number, "PAGE16");
  } finally {
    // 테스트 연결을 닫는다.
    client.close();
  }
});
