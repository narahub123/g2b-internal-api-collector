/**
 * 목록에서 선택 지역과 별도의 제한 없음 키를 추출한다.
 * @param row 신규 목록 행 또는 초기 적재 시 목록을 가리키는 별칭.
 * @param table 초기 적재에 읽을 테이블. 트리거의 단일 행이면 생략한다.
 * @returns 중복 없이 지역 매핑을 추가하는 SQL.
 */
function insertNoticeRegions(row: string, table?: string) {
  // 숫자나 JSON null은 화면이 보내는 문자열 지역과 일치하지 않는다.
  const keys = `${row}.number, ${row}.revision, ${row}.opening_revision`;
  const source = table ? `FROM ${table} ${row}` : "";
  const regions = `${source} ${table ? "CROSS JOIN" : "FROM"} json_each(${row}.fields, '$.regions') entry`;
  // 별도의 종류 값으로 제한 없음과 일반 지역을 구별한다.
  return `INSERT INTO g2b_notice_region_keys
    SELECT 0, '', ${keys} ${source}
      WHERE json_extract(${row}.fields, '$.unrestrictedRegion') = 1
    UNION
    SELECT 1, entry.value, ${keys} ${regions} WHERE typeof(entry.value) = 'text'`;
}

// 지역을 탐색하는 방향과 목록 키 변경을 동기화하는 방향에 각각 인덱스를 둔다.
const removeOldRegions = `DELETE FROM g2b_notice_region_keys WHERE number = OLD.number
  AND revision = OLD.revision AND opening_revision = OLD.opening_revision`;

// 원본 검색값이 바뀌지 않은 수집 상태나 표시값 갱신에서는 매핑을 유지한다.
export const noticeRegionSchema = `
  CREATE TABLE g2b_notice_region_keys (
    kind INTEGER NOT NULL, region TEXT NOT NULL, number TEXT NOT NULL,
    revision TEXT NOT NULL, opening_revision TEXT NOT NULL,
    PRIMARY KEY (kind, region, number, revision, opening_revision)
  ) WITHOUT ROWID;
  CREATE INDEX g2b_notice_region_keys_notice
    ON g2b_notice_region_keys(number, revision, opening_revision);
  CREATE TRIGGER g2b_notice_region_keys_insert AFTER INSERT ON g2b_notice_list
    BEGIN ${insertNoticeRegions("NEW")}; END;
  CREATE TRIGGER g2b_notice_region_keys_delete AFTER DELETE ON g2b_notice_list
    BEGIN ${removeOldRegions}; END;
  CREATE TRIGGER g2b_notice_region_keys_update AFTER UPDATE ON g2b_notice_list
    WHEN OLD.number IS NOT NEW.number OR OLD.revision IS NOT NEW.revision
      OR OLD.opening_revision IS NOT NEW.opening_revision
      OR json_extract(OLD.fields, '$.regions') IS NOT json_extract(NEW.fields, '$.regions')
      OR json_extract(OLD.fields, '$.unrestrictedRegion') IS NOT json_extract(NEW.fields, '$.unrestrictedRegion')
    BEGIN ${removeOldRegions}; ${insertNoticeRegions("NEW")}; END;
`;

// 초기 적재의 Hrana 통계는 스키마 생성과 독립된 응답으로 기록한다.
export const noticeRegionBackfill = insertNoticeRegions("listed", "g2b_notice_list");
