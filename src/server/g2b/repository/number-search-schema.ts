import { numberSearchSections, type NumberSearchSection } from "./number-search-config";

// 업무·출처·조각 순으로 검색하고, 반대 방향의 키로 목록 변경을 동기화한다.
export const numberSearchSchema = `
  CREATE TABLE g2b_number_search_grams (
    section INTEGER NOT NULL, source INTEGER NOT NULL, gram TEXT NOT NULL,
    number TEXT NOT NULL, revision TEXT NOT NULL, opening_revision TEXT NOT NULL,
    PRIMARY KEY (section, source, gram, number, revision, opening_revision)
  ) WITHOUT ROWID;
  CREATE INDEX g2b_number_search_grams_key
    ON g2b_number_search_grams (section, number, revision, opening_revision);
`;

/**
 * 기존 부분 일치 대상에서 조각을 추출할 SQL을 작성한다.
 * @param input 복합 키와 출처별 검색 문자열을 공급하는 SELECT.
 * @returns 중복을 허용하는 조각과 키의 SELECT.
 */
function selectGrams(input: string) {
  // NUL을 포함하는 값은 빈 조각으로 표시해 해당 출처의 검색을 기존 방식으로 돌린다.
  return `WITH RECURSIVE inputs AS MATERIALIZED (${input}),
    positions(source, number, revision, opening_revision, value, pos, last) AS (
      SELECT source, number, revision, opening_revision, value, 1, length(value) - 2
      FROM inputs WHERE length(value) >= 3 AND instr(value, char(0)) = 0
      UNION ALL
      SELECT source, number, revision, opening_revision, value, pos + 1, last FROM positions WHERE pos < last
    )
    SELECT source, substr(value, pos, 3) AS gram, number, revision, opening_revision FROM positions
    UNION ALL
    SELECT source, '', number, revision, opening_revision FROM inputs WHERE instr(value, char(0)) > 0`;
}

/**
 * 업무의 목록을 초기화하고 저장·갱신·삭제를 조각 테이블에 동기화하는 SQL을 만든다.
 * @param section 검색 원본과 목록 테이블을 고르는 업무 식별자.
 * @returns 같은 트랜잭션에서 실행할 트리거 설치문과 초기 적재문.
 */
export function numberSearchSectionSql(section: NumberSearchSection) {
  // 내부 업무 설정으로만 SQL 식별자를 결정한다.
  const { id, table, number, receipt } = numberSearchSections[section];
  /**
   * 초기 적재와 트리거가 같은 출처와 검색 문자열을 사용하도록 SELECT를 만든다.
   * @param row 목록을 가리키는 별칭 또는 NEW.
   * @param from 초기 적재에만 필요한 목록 FROM 절.
   * @returns 중복을 제거한 조각을 저장하는 INSERT.
   */
  function insert(row: string, from: string) {
    // 번호·차수와 접수번호를 구분하고 빈값은 조각 생성 단계에서 건너뛴다.
    const key = `${row}.number AS number, ${row}.revision AS revision, ${row}.opening_revision AS opening_revision`;
    const input = `SELECT 1 AS source, ${key}, ${number.replaceAll("@", row)} AS value ${from}`
      + (receipt ? ` UNION ALL SELECT 2, ${key}, ${receipt.replaceAll("@", row)} ${from}` : "");
    // 상위 저장문의 충돌 정책에 의존하지 않도록 같은 키의 반복 조각을 삽입 전에 제거한다.
    return `INSERT INTO g2b_number_search_grams
      SELECT ${id}, source, gram, number, revision, opening_revision
      FROM (SELECT DISTINCT * FROM (${selectGrams(input)}))`;
  }
  // 목록의 기존 복합 키만 삭제해 다른 업무나 차수의 조각을 보존한다.
  const remove = `DELETE FROM g2b_number_search_grams WHERE section = ${id}
    AND number = OLD.number AND revision = OLD.revision AND opening_revision = OLD.opening_revision`;
  // 표시 데이터나 수집 상태만 달라진 갱신에는 조각을 다시 쓰지 않는다.
  const receiptChanged = receipt ? ` OR ${receipt.replaceAll("@", "OLD")} IS NOT ${receipt.replaceAll("@", "NEW")}` : "";
  const changed = "OLD.number IS NOT NEW.number OR OLD.revision IS NOT NEW.revision OR OLD.opening_revision IS NOT NEW.opening_revision" + receiptChanged;
  // 동기화와 초기 적재는 호출자가 하나의 마이그레이션 트랜잭션에서 처리한다.
  return {
    triggers: `
      CREATE TRIGGER ${table}_number_grams_insert AFTER INSERT ON ${table}
        BEGIN ${insert("NEW", "")}; END;
      CREATE TRIGGER ${table}_number_grams_delete AFTER DELETE ON ${table}
        BEGIN ${remove}; END;
      CREATE TRIGGER ${table}_number_grams_update AFTER UPDATE ON ${table} WHEN ${changed}
        BEGIN ${remove}; ${insert("NEW", "")}; END;
    `,
    backfill: insert("listed", `FROM ${table} listed`),
  };
}
