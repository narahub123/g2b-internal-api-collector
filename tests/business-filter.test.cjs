const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { openOpeningResultList } = require("../src/server/g2b/repository/opening-result-list");

/** 개찰결과 후보 중복 제거, 연결 공고 우선순위와 매핑 롤백을 검증한다. */
test("업무구분 필터는 복합 키 중복과 연결 공고 변경을 반영한다", async () => {
  // 메모리 DB에 빈 스키마를 구축하고 마이그레이션 재실행을 확인한다.
  const client = createClient({ url: "file::memory:" });
  try {
    // 초기 설치와 재실행 모두에서 동일한 트리거를 사용한다.
    await migrateG2bDatabase(client);
    await migrateG2bDatabase(client);
    // 모집단이 충분한 목록과 두 업무구분에 동시에 해당하는 개찰차수를 저장한다.
    await client.execute(`WITH RECURSIVE ids(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM ids WHERE i<100)
      INSERT INTO opening_results SELECT printf('BUSINESS%03d',i),'000','001','2026-11-24','{}',
        json_object('fields',json_object('businesses',json(CASE WHEN i=1 THEN
          '[{"code":"01","label":"물품"},{"label":"용역"}]' ELSE '[{"code":"99","label":"기타"}]' END)))
      FROM ids`);
    // 실제 목록 경로에서 코드와 라벨 동시 선택이 복합 키 하나만 반환하는지 확인한다.
    const db = new G2bDatabase(client);
    const list = openOpeningResultList(db);
    const query = { search: { field: "title", query: "" }, filters: { business: ["01", "용역"] }, status: "total", sort: "date-desc", page: 300 };
    const result = await list.page(query);
    assert.deepEqual(result.rows.map(({ number, openingRevision }) => [number, openingRevision]), [["BUSINESS001", "001"]]);
    assert.deepEqual(result.counts, { total: 1, collected: 1, uncollected: 0 });
    assert.equal(result.page, 1);
    // 연결 공고의 업무구분이 기존 두 값을 대신하는지 같은 트랜잭션에서 검사한다.
    await db.transaction(async () => {
      // 연결 우선순위가 반영된 파생 목록과 매핑을 변경한다.
      await db.prepare(`INSERT INTO notices VALUES ('BUSINESS001','000','2026-11-24','{}',
        '{"linkedCode":"03","linkedBusiness":[{"code":"03","label":"공사"}]}')`).all();
      // 변경된 선택은 후보가 없고, 새 값은 같은 차수를 가리킨다.
      assert.equal((await list.page(query)).counts.total, 0);
      const newSelection = { ...query, filters: { business: ["03"] } };
      assert.equal((await list.page(newSelection)).counts.total, 1);
      // 의도적으로 실패시켜 원본·파생 목록·매핑의 트랜잭션 롤백을 확인한다.
      throw new Error("업무구분 롤백");
    }).then(() => assert.fail("롤백이 필요합니다"), error => assert.match(error.message, /업무구분 롤백/));
    // 롤백 후에는 이전 업무구분 후보와 기존 결과를 다시 읽는다.
    assert.deepEqual(await list.page(query), result);
    // 원본을 삭제하면 후보 키도 제거된다.
    await client.execute("DELETE FROM opening_results WHERE number='BUSINESS001'");
    assert.equal((await list.page(query)).counts.total, 0);
  } finally {
    // 테스트 전용 연결을 닫는다.
    client.close();
  }
});
