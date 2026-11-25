import { nameSearchSections, numberSearchSections, type NumberSearchSection } from "./number-search-config";

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
 * 한 업무의 검색 문자열에서 중복을 제거한 조각 삽입 SQL을 만든다.
 * @param id 공통 인덱스의 업무 식별자.
 * @param input 출처, 복합 키, 검색 문자열을 반환하는 SELECT.
 * @returns 상위 SQL 문장의 충돌 정책과 무관하게 중복을 제거한 INSERT.
 */
function insertGrams(id: number, input: string) {
  // 원본 문자열에서 같은 조각이 반복되어도 공통 인덱스에는 한 행만 저장한다.
  return `INSERT INTO g2b_number_search_grams
    SELECT ${id}, source, gram, number, revision, opening_revision
    FROM (SELECT DISTINCT * FROM (${selectGrams(input)}))`;
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
    // 상위 저장문의 충돌 정책에 의존하지 않도록 공통 중복 제거 SQL을 사용한다.
    return insertGrams(id, input);
  }
  // 목록의 기존 복합 키만 삭제해 다른 업무나 차수의 조각을 보존한다.
  const remove = `DELETE FROM g2b_number_search_grams WHERE section = ${id} AND source IN (1, 2)
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

/**
 * 제목과 기관명의 초기 적재와 출처별 목록 동기화 SQL을 만든다.
 * @param section 이름 검색이 활성화된 목록 업무.
 * @param itemsOnly 계약요청 세부품명만 설치할 때 사용하고 기존 마이그레이션에서는 생략한다.
 * @returns 해당 업무에 적용할 출처별 트리거 SQL과 적재 SQL.
 */
export function nameSearchSectionSql(section: NumberSearchSection, itemsOnly = false) {
  // 활성화한 이름 출처와 기존 목록의 복합 키 정의를 읽는다.
  const names = nameSearchSections[section];
  const { id, table } = numberSearchSections[section];
  const fields = itemsOnly ? [{ source: 5, expression: names?.item, arrayPath: "$.names" }] : [
    { source: 3, expression: names?.title, arrayPath: undefined },
    { source: 4, expression: names?.agency?.expression, arrayPath: names?.agency?.array ? "$.agencies" : undefined },
  ];
  // 비활성 출처에는 트리거와 조각을 설치하지 않는다.
  return fields.flatMap(({ source, expression, arrayPath }) => {
    if (!expression) return [];
    /**
     * 기관과 세부품명 배열은 개별 항목에서 조각을 추출하도록 출처 SELECT를 구성한다.
     * @param row 초기 적재의 목록 별칭 또는 트리거의 NEW.
     * @param backfill 전체 목록에서 적재할 때만 true.
     * @returns 해당 출처의 조각을 저장하는 INSERT.
     */
    function insert(row: string, backfill: boolean) {
      // 기존 검색 SQL의 단일 이름 또는 배열의 개별 값을 그대로 읽는다.
      const value = expression?.replaceAll("@", row);
      const keys = `${row}.number AS number, ${row}.revision AS revision, ${row}.opening_revision AS opening_revision`;
      const rows = backfill ? ` FROM ${table} listed` : "";
      const entries = arrayPath ? `${backfill ? " CROSS JOIN" : " FROM"} json_each(${row}.fields, '${arrayPath}') entry` : "";
      // 한 목록 키에서 여러 배열 항목에 같은 조각이 있어도 한 번만 저장한다.
      return insertGrams(id, `SELECT ${source} AS source, ${keys}, ${arrayPath ? "entry.value" : value} AS value${rows}${entries}`);
    }
    // 키가 같아도 해당 출처의 검색 문자열이 바뀌면 그 출처만 교체한다.
    const changed = `OLD.number IS NOT NEW.number OR OLD.revision IS NOT NEW.revision
      OR OLD.opening_revision IS NOT NEW.opening_revision
      OR ${expression.replaceAll("@", "OLD")} IS NOT ${expression.replaceAll("@", "NEW")}`;
    const remove = `DELETE FROM g2b_number_search_grams WHERE section = ${id} AND source = ${source}
      AND number = OLD.number AND revision = OLD.revision AND opening_revision = OLD.opening_revision`;
    // 같은 트랜잭션에서 기존 키 삭제와 새 키 삽입을 처리한다.
    return [{
      triggers: `
        CREATE TRIGGER ${table}_name_grams_${source}_insert AFTER INSERT ON ${table}
          BEGIN ${insert("NEW", false)}; END;
        CREATE TRIGGER ${table}_name_grams_${source}_delete AFTER DELETE ON ${table}
          BEGIN ${remove}; END;
        CREATE TRIGGER ${table}_name_grams_${source}_update AFTER UPDATE ON ${table} WHEN ${changed}
          BEGIN ${remove}; ${insert("NEW", false)}; END;
      `,
      backfill: insert("listed", true),
    }];
  });
}
