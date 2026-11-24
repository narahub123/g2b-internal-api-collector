import { searchText } from "./collection-list-query";
import type { G2bDatabase, SQLInputValue } from "./database";
import { nameSearchSections, numberSearchSections, type NumberSearchSection } from "./number-search-config";

// 각 검색 출처에서 기존 부분 일치 결과를 포함할 수 있는 조각을 하나씩 저장한다.
export type SearchGram = {
  // 번호·차수, 접수번호, 제목, 기관명의 고정 출처 식별자다.
  source: number;
  // 한도 안에서 건수를 확인한 조각이다.
  gram: string;
};

/**
 * 검색어 끝에서 서로 다른 세 글자 조합을 최대 세 개까지 선택한다.
 * @param search 기존 검색 조건과 동일한 값을 정규화한 문자열.
 * @returns SQLite substr와 같은 문자 단위로 잘라 낸 조각.
 */
function lastGrams(search: string) {
  // 보조 문자가 UTF-16 코드 단위 사이에서 잘리지 않도록 문자 단위로 분리한다.
  const characters = Array.from(search);
  const grams = new Set<string>();
  // 같은 조각의 중복 탐색을 피하면서 앞쪽으로 진행한다.
  for (let end = characters.length; end >= 3 && grams.size < 3; end--) {
    grams.add(characters.slice(end - 3, end).join(""));
  }
  // 삽입 순서대로 검토하여 동률인 경우 먼저 본 조각을 쓴다.
  return [...grams];
}

/**
 * 목록 검색에서 전체 스캔을 피할 수 있는 조각을 출처별로 선택한다.
 * @param db 목록 및 공통 인덱스를 함께 조회하는 연결.
 * @param section 기존 검색 정규화와 업무별 건수를 결정하는 목록 업무.
 * @param search 화면에서 검증한 검색 필드와 원래 검색어.
 * @param run 안전한 조각 또는 기존 경로를 나타내는 빈 배열로 목록을 조회하는 함수.
 * @returns 기존 목록과 같은 결과.
 * @throws DB 탐색 또는 목록 쿼리가 실패하면 호출자에게 오류를 전달한다.
 */
export function withListSearch<T>(
  db: G2bDatabase,
  section: NumberSearchSection,
  search: { field: string; query: string },
  run: (grams: SearchGram[]) => Promise<T>,
) {
  // 기존 번호 정규화와 이름 정규화 중 화면의 검색 필드에 맞는 출처를 고른다.
  const { id, receipt } = numberSearchSections[section];
  const { field, query: keyword } = search;
  const names = nameSearchSections[section];
  const needles: { source: number; grams: string[] }[] = [];
  if (field === "number") {
    // 발주계획은 구분자를 보존하고 접수번호는 원래 검색어를 정규화한다.
    const stripped = section === "order-plans" ? keyword : keyword.replace(/[\s/-]+/g, "");
    needles.push({ source: 1, grams: lastGrams(searchText(receipt ? stripped || keyword : stripped)) });
    if (receipt) needles.push({ source: 2, grams: lastGrams(searchText(keyword)) });
  } else if ((field === "title" && names?.title) || (field === "agency" && names?.agency)) {
    // 이름 검색어에서 번호의 구분자 제거를 적용하지 않는다.
    needles.push({ source: field === "title" ? 3 : 4, grams: lastGrams(searchText(keyword)) });
  }
  // 지원 출처가 없거나 한 출처라도 짧으면 기존 목록을 조회한다.
  if (!needles.length || needles.some(({ grams }) => !grams.length)) return run([]);

  // 후보의 한도 및 최종 결과가 같은 읽기 스냅샷에 속하도록 묶는다.
  return db.transaction(async () => {
    // 업무 전체 집계와 조각으로 표현할 수 없는 키의 존재를 한 번 확인한다.
    const population = await db.prepare(`SELECT total,
      EXISTS (SELECT 1 FROM g2b_number_search_grams WHERE section = ${id}
        AND source IN (${needles.map(({ source }) => source).join(", ")}) AND gram = '') AS hasUnsupportedKey
      FROM g2b_collection_list_counts WHERE section = ? AND scope = 'all'`).get(section);
    // 미지원 문자열을 제외할 수 없거나 모집단이 너무 작으면 기존 부분 일치를 사용한다.
    const limit = Math.min(128, Math.floor(Number(population?.total ?? 0) * 13 / 1000));
    if (!limit || population?.hasUnsupportedKey) return run([]);
    // 각 조각과 요청 전체의 탐색 상한을 적용한다.
    const probe = db.prepare(`SELECT COUNT(*) AS candidates FROM (
      SELECT 1 FROM g2b_number_search_grams WHERE section = ${id} AND source = ? AND gram = ? LIMIT ?
    )`);
    let remaining = limit * 3;
    const chosen: SearchGram[] = [];
    // 두 출처를 모두 확인해야 OR 조건의 전체 결과를 보존할 수 있다.
    for (const [index, { source, grams }] of needles.entries()) {
      // 첫 출처에 세 번 모두 소모하지 않도록 다음 출처의 탐색 분량을 남긴다.
      const reserve = (needles.length - index - 1) * limit;
      let best = limit;
      let selected: SearchGram | undefined;
      for (const gram of grams) {
        // 남은 한도에 도달한 탐색은 실제 건수가 더 많을 수 있어 후보로 사용하지 않는다.
        const cap = Math.min(best, remaining - reserve);
        if (cap <= 0) break;
        const count = Number((await probe.get(source, gram, cap))?.candidates);
        remaining -= count;
        if (count < cap) {
          best = count;
          selected = { source, gram };
          // 빈 조각 범위는 이 출처의 검색 결과도 없음을 보장한다.
          if (!count) break;
        }
      }
      // 하나의 출처라도 포화됐으면 제한 없는 기존 SQL로 처리한다.
      if (!selected) return run([]);
      chosen.push(selected);
    }
    // 양쪽의 안전한 후보와 기존 부분 일치 조건으로 결과를 검증한다.
    return run(chosen);
  }, false);
}

/**
 * 일치 행을 집계와 페이지에서 재사용할 수 있는 SQL 소스를 만든다.
 * @param section 목록 테이블과 조각의 업무 범위.
 * @param grams 각 검색 출처의 안전한 후보 조각.
 * @param condition 기존 검색·필터·노출 조건.
 * @param values 기존 조건의 바인딩 인자.
 * @returns 목록 대신 읽을 관계와 필요할 때만 추가할 공통 CTE 및 인자.
 */
export function numberSearchSource(section: NumberSearchSection, grams: SearchGram[], condition: string, values: SQLInputValue[]) {
  // 인덱스를 사용하지 않는 요청은 기존 목록 관계와 실행 계획을 보존한다.
  const { id, table } = numberSearchSections[section];
  if (!grams.length) return { prefix: "", filtered: `${table} WHERE ${condition}`, page: `${table} WHERE ${condition} AND`, args: null };
  // 둘 다 일치하는 행을 한 번만 읽도록 UNION으로 복합 키를 합친다.
  const keys = grams.map(({ source }) => `SELECT number AS gramNumber, revision AS gramRevision, opening_revision AS gramOpening
    FROM g2b_number_search_grams WHERE section = ${id} AND source = ${source} AND gram = ?`).join(" UNION ");
  // 조각 인덱스가 검색의 바깥 루프가 되게 하고 기존 필터는 원래 목록 값으로 검사한다.
  const prefix = `matched AS MATERIALIZED (
    SELECT listed.* FROM (${keys}) CROSS JOIN ${table} listed
      ON listed.number = gramNumber AND listed.revision = gramRevision AND listed.opening_revision = gramOpening
    WHERE ${condition}
  ), `;
  // 일치 집합을 만든 후에는 수집 상태만 페이지에 추가한다.
  return { prefix, filtered: "matched", page: "matched WHERE", args: [...grams.map(({ gram }) => gram), ...values] };
}
