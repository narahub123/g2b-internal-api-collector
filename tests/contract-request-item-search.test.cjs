const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
const { G2bDatabase } = require("../src/server/g2b/repository/database");
const { openG2bRepository } = require("../src/server/g2b/repository/turso");

/** 표시 품명에서만 조각을 만들고 목록 변경과 함께 동기화하는지 검증한다. */
test("계약요청 세부품명 트라이그램은 표시 조건과 기존 부분 일치를 유지한다", async () => {
  // 빈 스키마에서 버전 31과 38 설치 및 재실행을 검증한다.
  const client = createClient({ url: "file::memory:" });
  try {
    // 최초 설치와 재실행 이후에도 동일한 저장소로 검색한다.
    await migrateG2bDatabase(client);
    await migrateG2bDatabase(client);
    const db = new G2bDatabase(client);
    const repo = openG2bRepository(db);
    const list = repo.collectionAttempts.contractRequestList;
    // 희소 조각이 탐색 상한에 도달하지 않도록 다른 수집 키를 추가한다.
    await client.execute(`WITH RECURSIVE ids(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM ids WHERE i<200)
      INSERT INTO g2b_collection_attempts(section,number,revision,opening_revision,input,started_at,status)
      SELECT 'contract-requests',printf('FILL%03d',i),'000','','{}','2026-11-25','failed' FROM ids`);

    /**
     * 저장 진입점에서 품명 가시성이 달라지는 원본을 저장한다.
     * @param {string} number 계약요청 번호.
     * @param {string} scope 품목 열의 가시성을 결정하는 업무구분.
     * @param {string[]} names 원본 품명 배열.
     * @returns {Promise<void>} 저장이 완료되면 종료된다.
     */
    async function save(number, scope, names) {
      // 표시 조건과 정규화는 애플리케이션 저장 경로에서 계산한다.
      await repo.saveContractRequest({ number, revision: "000", collectedAt: "2026-11-25",
        detail: { bizNm: "품목 요청", prcmBsneAreaCd: scope, prcmBsneAreaNm: "물품" },
        items: names.map(dtlsPrnm => ({ dtlsPrnm })) });
    }

    /**
     * 검색어로 검증용 계약요청 목록의 전체 일치 건수를 반환한다.
     * @param {string} keyword 기존 부분 일치 의미로 찾을 품명.
     * @returns {Promise<number>} 복합 키 중복 제거 후의 일치 건수.
     */
    async function count(keyword) {
      // 범위 초과 페이지로 요청해도 집계는 동일해야 한다.
      const result = await list.page({ filters: {}, search: { field: "item", query: keyword },
        sort: "written-desc", status: "total", page: 99999 });
      return result.counts.total;
    }

    // 동일 품명의 조각을 중복 등록하지 않고 다른 품명 사이를 이어 붙이지 않는다.
    await save("ITEM", "조070001", ["초정밀영상", "초정밀영상", "분리배열", "배열테스트"]);
    await save("HIDDEN", "조070003", ["숨겨진품명"]);
    assert.equal(await count("초정밀영상"), 1);
    assert.equal(await count("분리배열테스트"), 0);
    assert.equal(await count("숨겨진품명"), 0);
    assert.equal(await count("초정"), 1);
    // 출처 5에는 복합 키당 같은 조각이 한 번만 저장된다.
    const duplicate = await client.execute("SELECT COUNT(*) AS total FROM g2b_number_search_grams WHERE section=5 AND source=5 AND number='ITEM' AND gram='초정밀'");
    assert.equal(duplicate.rows[0].total, 1);
    // 품명 변경을 적용한 뒤 실패시키면 조각과 결과가 함께 복구된다.
    await assert.rejects(db.transaction(async () => {
      // 저장본과 조각을 같은 트랜잭션 안에서 변경한다.
      await save("ITEM", "조070001", ["교체영상장치"]);
      assert.equal(await count("교체영상장치"), 1);
      assert.equal(await count("초정밀영상"), 0);
      throw new Error("품명 롤백");
    }), /품명 롤백/);
    assert.equal(await count("초정밀영상"), 1);
    // NUL을 포함한 원본도 기존 부분 일치로 찾는다.
    await save("NUL", "조070001", ["앞쪽품명\0뒤쪽"]);
    assert.equal(await count("앞쪽품명"), 1);
    const marker = await client.execute("SELECT 1 FROM g2b_number_search_grams WHERE section=5 AND source=5 AND number='NUL' AND gram=''");
    assert.equal(marker.rows.length, 1);
    // 표시 조건 전환과 삭제는 기존 품명의 조각을 함께 제거한다.
    await save("ITEM", "조070003", ["초정밀영상"]);
    assert.equal(await count("초정밀영상"), 0);
    await client.execute("DELETE FROM contract_requests WHERE number='NUL'");
    assert.equal(await count("앞쪽품명"), 0);
    const removed = await client.execute("SELECT 1 FROM g2b_number_search_grams WHERE section=5 AND source=5 AND number IN ('ITEM','NUL')");
    assert.equal(removed.rows.length, 0);
  } finally {
    // 메모리 DB를 닫아 다음 테스트에서 데이터를 공유하지 않게 한다.
    client.close();
  }
});
