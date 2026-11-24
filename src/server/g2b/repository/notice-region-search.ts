import type { G2bDatabase, SQLInputValue } from "./database";

/**
 * 선택 지역의 매핑이 작을 때만 후보 키를 페이지 조회로 전달한다.
 * @param db 목록과 매핑을 함께 읽는 DB 연결.
 * @param regions 화면에서 선택한 지역 문자열.
 * @param run 희소 후보의 JSON 또는 기존 조회를 뜻하는 undefined로 목록을 실행하는 함수.
 * @returns 요청한 목록 조회 결과.
 * @throws 후보 탐색 또는 최종 목록 조회가 실패하면 오류를 전달한다.
 */
export function withNoticeRegionKeys<T>(
  db: G2bDatabase,
  regions: string[],
  run: (keys?: string) => Promise<T>,
) {
  // 후보와 목록이 수집·삭제 사이에 어긋나지 않도록 같은 읽기 스냅샷을 사용한다.
  return db.transaction(async () => {
    // 미리 유지한 전체 공고 건수로 매핑 탐색 상한을 계산한다.
    const population = await db.prepare(`SELECT total FROM g2b_collection_list_counts
      WHERE section = 'notices' AND scope = 'all'`).get();
    const limit = Math.min(256, Math.floor(Number(population?.total ?? 0) / 50));
    if (!limit) return run();
    // 중복 제거 전에 제한을 적용해 다중 지역 및 제한 없음이 많은 경우도 탐색 비용을 제한한다.
    const matches = await db.prepare(`
      SELECT number, revision, opening_revision FROM g2b_notice_region_keys WHERE kind = 0 AND region = ''
      UNION ALL
      SELECT number, revision, opening_revision FROM g2b_notice_region_keys WHERE kind = 1
        AND region IN (SELECT value FROM json_each(?))
      LIMIT ?`).all(JSON.stringify(regions), limit);
    // 상한에 도달하면 기존 지역 조건을 기존 정렬 경로에서 실행한다.
    if (matches.length >= limit) return run();
    // 최종 조회에서 매핑을 두 번 읽지 않도록 찾은 키를 묶어서 바인딩한다.
    return run(JSON.stringify(matches.map(({ number, revision, opening_revision }) => [number, revision, opening_revision])));
  }, false);
}

/**
 * 후보 키를 중복 제거하고 해당 목록에 기존 조건을 적용하는 CTE를 만든다.
 * @param keys 탐색한 복합 키의 JSON.
 * @param table 저장소 설정에서 가져온 목록 테이블 이름.
 * @param condition 기존 검색, 지역 및 다른 필터 조건.
 * @param values 기존 조건의 자리표시자 순서에 맞춘 값.
 * @returns 집계와 페이지에서 공유할 SQL 관계와 바인딩 값.
 */
export function listKeySource(keys: string, table: string, condition: string, values: SQLInputValue[]) {
  // 여러 선택값에 해당하는 목록 행도 복합 키 하나로 읽는다.
  const prefix = `candidate_keys AS MATERIALIZED (
    SELECT DISTINCT json_extract(value, '$[0]') AS candidateNumber,
      json_extract(value, '$[1]') AS candidateRevision, json_extract(value, '$[2]') AS candidateOpening
    FROM json_each(?)
  ), matched AS MATERIALIZED (
    SELECT listed.* FROM candidate_keys CROSS JOIN ${table} listed
      ON listed.number = candidateNumber AND listed.revision = candidateRevision AND listed.opening_revision = candidateOpening
    WHERE ${condition}
  ), `;
  // 기존 조회 조건을 통과한 행을 집계와 페이지에서 공유한다.
  return { prefix, filtered: "matched", page: "matched WHERE", args: [keys, ...values] };
}
