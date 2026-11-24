/**
 * 기존 번호 검색과 같은 문자열에서 연속한 세 글자를 목록 키별로 추출한다.
 * @param source 목록 복합 키를 공급하는 마이그레이션 또는 트리거의 SQL.
 * @returns 중복을 포함한 검색 조각과 목록 키를 반환하는 SELECT.
 */
function selectNumberGrams(source: string) {
  // SQLite의 문자열 위치를 사용해 검색에 쓰는 lower()와 동일한 기준을 유지한다.
  return `WITH RECURSIVE keys(number, revision, opening_revision, value) AS MATERIALIZED (
      SELECT number, revision, opening_revision, lower(number || revision) FROM (${source})
    ),
    positions(number, revision, opening_revision, value, pos, last) AS (
      SELECT number, revision, opening_revision, value, 1, length(value) - 2
      FROM keys WHERE length(value) >= 3 AND instr(value, char(0)) = 0
      UNION ALL
      SELECT number, revision, opening_revision, value, pos + 1, last FROM positions WHERE pos < last
    )
    SELECT substr(value, pos, 3) AS gram, number, revision, opening_revision FROM positions
    UNION ALL
    SELECT '', number, revision, opening_revision FROM keys WHERE instr(value, char(0)) > 0`;
}

// 목록 키 삽입과 변경에 공통으로 사용할 새 번호·차수의 조각을 계산한다.
const newGrams = selectNumberGrams("SELECT NEW.number AS number, NEW.revision AS revision, NEW.opening_revision AS opening_revision");
// 목록 키가 사라질 때 역방향 인덱스로 기존 조각만 지운다.
const deleteOldGrams = `DELETE FROM g2b_notice_number_grams
  WHERE number = OLD.number AND revision = OLD.revision AND opening_revision = OLD.opening_revision;`;
// 빈 조각은 SQLite substr가 끝까지 읽지 못하는 NUL 포함 키의 표시로만 사용한다.
export const noticeNumberGramsSchema = `
  CREATE TABLE g2b_notice_number_grams (
    gram TEXT NOT NULL, number TEXT NOT NULL, revision TEXT NOT NULL, opening_revision TEXT NOT NULL,
    PRIMARY KEY (gram, number, revision, opening_revision)
  ) WITHOUT ROWID;
  CREATE INDEX g2b_notice_number_grams_key ON g2b_notice_number_grams (number, revision, opening_revision);
  CREATE TRIGGER g2b_notice_number_grams_insert AFTER INSERT ON g2b_notice_list BEGIN
    INSERT OR IGNORE INTO g2b_notice_number_grams SELECT * FROM (${newGrams});
  END;
  CREATE TRIGGER g2b_notice_number_grams_delete AFTER DELETE ON g2b_notice_list BEGIN
    ${deleteOldGrams}
  END;
  CREATE TRIGGER g2b_notice_number_grams_update
    AFTER UPDATE OF number, revision, opening_revision ON g2b_notice_list
    WHEN OLD.number <> NEW.number OR OLD.revision <> NEW.revision OR OLD.opening_revision <> NEW.opening_revision
    BEGIN
      ${deleteOldGrams}
      INSERT OR IGNORE INTO g2b_notice_number_grams SELECT * FROM (${newGrams});
    END;
`;

// 초기 적재의 행 통계를 개별 SQL 응답으로 확인할 수 있도록 생성문과 분리한다.
export const noticeNumberGramsBackfill = `INSERT OR IGNORE INTO g2b_notice_number_grams
  ${selectNumberGrams("SELECT number, revision, opening_revision FROM g2b_notice_list")}`;
