import type { G2bDatabase } from "./database";

/**
 * 정규화한 검색어 끝에서 서로 다른 세 글자 조합을 최대 세 개까지 선택한다.
 * @param search 기존 공고번호 검색과 동일하게 정규화된 검색어.
 * @returns SQLite substr와 같은 문자 단위로 잘라 탐색할 조각.
 */
export function noticeNumberGrams(search: string) {
  // 유니코드 보조 문자를 중간에서 나누지 않도록 코드 포인트로 분리한다.
  const characters = Array.from(search);
  const grams = new Set<string>();
  // 뒤에서부터 비어 있지 않은 서로 다른 조각만 탐색 후보에 넣는다.
  for (let end = characters.length; end >= 3 && grams.size < 3; end--) {
    grams.add(characters.slice(end - 3, end).join(""));
  }
  // 탐색 순서를 유지하여 건수가 같은 경우 먼저 검사한 조각을 쓴다.
  return [...grams];
}

/**
 * 같은 읽기 트랜잭션에서 원래 검색을 좁힐 수 있는 조각을 찾는다.
 * @param db 공고 목록과 조각 인덱스를 함께 조회하는 저장소 연결.
 * @param grams 정규화된 검색어에서 뽑은 최대 세 개의 조각.
 * @returns 충분히 드문 조각 또는 기존 목록 쿼리를 사용할 undefined.
 * @throws 집계나 조각 범위 탐색에 실패하면 저장소 오류를 전달한다.
 */
export async function findSelectiveNoticeNumberGram(db: G2bDatabase, grams: string[]) {
  // 조각은 사용자와 관리자 공고를 모두 담으므로 전체 목록 모집단을 사용한다.
  const population = await db.prepare(`SELECT total,
    EXISTS (SELECT 1 FROM g2b_notice_number_grams WHERE gram = '') AS hasUnsupportedKey
    FROM g2b_collection_list_counts WHERE section = 'notices' AND scope = 'all'`).get();
  // NUL을 포함한 기존 키는 SQLite의 문자열 조각으로 완전히 표현할 수 없다.
  if (!population || population.hasUnsupportedKey) return undefined;
  // 한도가 0이면 작은 목록을 기존 쿼리로 조회한다.
  const limit = Math.min(128, Math.floor(Number(population.total) * 13 / 1000));
  if (limit === 0) return undefined;
  // 탐색 한도까지 읽은 조각은 실제 후보가 더 있을 수 있으므로 포화로 처리한다.
  const probe = db.prepare(`SELECT COUNT(*) AS candidates FROM (
    SELECT 1 FROM g2b_notice_number_grams WHERE gram = ? LIMIT ?
  )`);
  // 더 적은 후보를 찾을 때마다 탐색 상한도 줄여 흔한 조각의 비용을 제한한다.
  let bestCount = limit;
  let selected: string | undefined;
  for (const gram of grams) {
    // 상한에 도달하면 기존 최선보다 후보가 적다는 근거가 없으므로 건너뛴다.
    const result = await probe.get(gram, bestCount);
    const count = Number(result?.candidates);
    if (count < bestCount) {
      selected = gram;
      bestCount = count;
      // 후보가 없는 조각을 찾으면 원래 문자열도 일치할 수 없으므로 탐색을 마친다.
      if (count === 0) break;
    }
  }
  // 한도 안에 들어온 조각이 있을 때만 후보를 제한한다.
  return selected;
}
