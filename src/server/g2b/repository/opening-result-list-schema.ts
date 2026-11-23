import { openingListFields, openingBusinessPair, businessTriggers, noticeTriggers } from "./opening-result-list-triggers";

// 기본 날짜는 개찰 원본에서 가져오고 정규화 제목과 필터에는 연결 공고를 반영한다.
const savedFields = `c.collected_at, ${openingListFields}, json_extract(c.query_data, '$.fields.date'),
  NULLIF(COALESCE(json_extract(n.query_data, '$.openingSearchTitle'), json_extract(c.query_data, '$.searchTitle')), '')`;

/**
 * 원본 행의 복합 키를 목록 갱신 뷰에 전달한다.
 * @param row 저장 결과 또는 수집 시도의 변경 전 또는 변경 후 별칭.
 * @param attempt 수집 이력의 업무 조건을 적용할지 결정한다.
 * @returns 개찰진행차수 하나를 다시 계산하는 SQL.
 */
function refreshKey(row: "OLD" | "NEW", attempt = false) {
  // 저장 결과와 이력 모두에 세 키를 사용하며 다른 업무의 시도는 건너뛴다.
  return `INSERT INTO g2b_opening_result_list_refresh SELECT ${row}.number, ${row}.revision, ${row}.opening_revision
    ${attempt ? `WHERE ${row}.section = 'opening-results'` : ""};`;
}

// 기존 데이터를 채우고 이후 원본의 변경과 목록 집계를 같은 트랜잭션에 묶는다.
export const openingResultListSchema = `
  CREATE TABLE g2b_opening_result_list (
    number TEXT NOT NULL, revision TEXT NOT NULL, opening_revision TEXT NOT NULL,
    collected_at TEXT, fields TEXT, sortDate TEXT, sortTitle TEXT, latest_id INTEGER,
    PRIMARY KEY(number, revision, opening_revision)
  ) WITHOUT ROWID;
  CREATE INDEX g2b_opening_result_list_date ON g2b_opening_result_list(sortDate DESC, number, revision, opening_revision);
  CREATE INDEX g2b_opening_result_list_collected ON g2b_opening_result_list(sortDate DESC, number, revision, opening_revision)
    WHERE collected_at IS NOT NULL;
  CREATE INDEX g2b_opening_result_list_uncollected ON g2b_opening_result_list(sortDate DESC, number, revision, opening_revision)
    WHERE collected_at IS NULL;
  CREATE TABLE g2b_opening_result_list_businesses (
    pair TEXT PRIMARY KEY, uses INTEGER NOT NULL CHECK (uses >= 0)
  ) WITHOUT ROWID;
  CREATE INDEX g2b_opening_result_list_businesses_empty ON g2b_opening_result_list_businesses(uses) WHERE uses = 0;

  -- 저장 결과와 이력 키를 합치고 기존과 동일한 최신 시도와 연결 공고를 적용한다.
  WITH latest AS MATERIALIZED (
    SELECT number, revision, opening_revision, MAX(id) AS id FROM g2b_collection_attempts
    WHERE section = 'opening-results' GROUP BY number, revision, opening_revision
  ), keys AS (
    SELECT number, revision, opening_revision FROM opening_results
    UNION SELECT number, revision, opening_revision FROM latest
  )
  INSERT INTO g2b_opening_result_list
  SELECT k.number, k.revision, k.opening_revision, ${savedFields}, latest.id
  FROM keys k LEFT JOIN opening_results c USING(number, revision, opening_revision)
  LEFT JOIN notices n ON n.number = c.number AND n.revision = c.revision AND json_valid(n.data)
  LEFT JOIN latest USING(number, revision, opening_revision);
  INSERT INTO g2b_collection_list_counts(section, scope, total, collected)
    SELECT 'opening-results', 'all', COUNT(*), COUNT(collected_at) FROM g2b_opening_result_list;
  -- 초기 선택지도 이후 트리거와 같이 저장된 진행차수만 집계한다.
  INSERT INTO g2b_opening_result_list_businesses
    SELECT pair, COUNT(*) FROM (
      SELECT DISTINCT c.number, c.revision, c.opening_revision, ${openingBusinessPair} AS pair
      FROM g2b_opening_result_list c, json_each(c.fields, '$.businesses') b
      WHERE c.collected_at IS NOT NULL
    ) GROUP BY pair;

  -- 집계에는 키 추가·삭제와 수집 여부 변화만 반영한다.
  CREATE TRIGGER g2b_opening_result_list_count_insert AFTER INSERT ON g2b_opening_result_list BEGIN
    UPDATE g2b_collection_list_counts SET total = total + 1, collected = collected + (NEW.collected_at IS NOT NULL)
      WHERE section = 'opening-results' AND scope = 'all';
  END;
  CREATE TRIGGER g2b_opening_result_list_count_delete AFTER DELETE ON g2b_opening_result_list BEGIN
    UPDATE g2b_collection_list_counts SET total = total - 1, collected = collected - (OLD.collected_at IS NOT NULL)
      WHERE section = 'opening-results' AND scope = 'all';
  END;
  CREATE TRIGGER g2b_opening_result_list_count_update AFTER UPDATE OF collected_at ON g2b_opening_result_list
  WHEN (NEW.collected_at IS NULL) <> (OLD.collected_at IS NULL) BEGIN
    UPDATE g2b_collection_list_counts SET collected = collected + (NEW.collected_at IS NOT NULL) - (OLD.collected_at IS NOT NULL)
      WHERE section = 'opening-results' AND scope = 'all';
  END;

  -- 저장본과 최신 이력을 복합 키로 확인하고 두 원본이 없는 키를 지운다.
  CREATE VIEW g2b_opening_result_list_refresh AS
    SELECT number, revision, opening_revision FROM g2b_opening_result_list WHERE FALSE;
  CREATE TRIGGER g2b_opening_result_list_refresh_key INSTEAD OF INSERT ON g2b_opening_result_list_refresh BEGIN
    INSERT INTO g2b_opening_result_list
    SELECT NEW.number, NEW.revision, NEW.opening_revision, ${savedFields},
      (SELECT id FROM g2b_collection_attempts WHERE section = 'opening-results' AND number = NEW.number
        AND revision = NEW.revision AND opening_revision = NEW.opening_revision ORDER BY id DESC LIMIT 1) AS latest_id
    FROM (SELECT 1) LEFT JOIN opening_results c ON c.number = NEW.number AND c.revision = NEW.revision
      AND c.opening_revision = NEW.opening_revision
    LEFT JOIN notices n ON n.number = c.number AND n.revision = c.revision AND json_valid(n.data)
    WHERE c.number IS NOT NULL OR latest_id IS NOT NULL
    ON CONFLICT(number, revision, opening_revision) DO UPDATE SET collected_at = excluded.collected_at,
      fields = excluded.fields, sortDate = excluded.sortDate, sortTitle = excluded.sortTitle, latest_id = excluded.latest_id
    WHERE collected_at IS NOT excluded.collected_at OR fields IS NOT excluded.fields
      OR sortDate IS NOT excluded.sortDate OR sortTitle IS NOT excluded.sortTitle OR latest_id IS NOT excluded.latest_id;
    DELETE FROM g2b_opening_result_list WHERE number = NEW.number AND revision = NEW.revision
      AND opening_revision = NEW.opening_revision
      AND NOT EXISTS (SELECT 1 FROM opening_results WHERE number = NEW.number AND revision = NEW.revision
        AND opening_revision = NEW.opening_revision)
      AND NOT EXISTS (SELECT 1 FROM g2b_collection_attempts WHERE section = 'opening-results' AND number = NEW.number
        AND revision = NEW.revision AND opening_revision = NEW.opening_revision);
  END;

  -- 저장 결과와 수집 시도 변경은 직접 영향을 받는 개찰진행차수만 갱신한다.
  CREATE TRIGGER g2b_opening_result_list_saved_insert AFTER INSERT ON opening_results BEGIN
    ${refreshKey("NEW")}
  END;
  CREATE TRIGGER g2b_opening_result_list_saved_delete AFTER DELETE ON opening_results BEGIN
    ${refreshKey("OLD")}
  END;
  CREATE TRIGGER g2b_opening_result_list_saved_update
  AFTER UPDATE OF number, revision, opening_revision, query_data, collected_at ON opening_results
  WHEN OLD.number IS NOT NEW.number OR OLD.revision IS NOT NEW.revision OR OLD.opening_revision IS NOT NEW.opening_revision
    OR OLD.query_data IS NOT NEW.query_data OR OLD.collected_at IS NOT NEW.collected_at BEGIN
    INSERT INTO g2b_opening_result_list_refresh SELECT OLD.number, OLD.revision, OLD.opening_revision
      WHERE OLD.number IS NOT NEW.number OR OLD.revision IS NOT NEW.revision OR OLD.opening_revision IS NOT NEW.opening_revision;
    ${refreshKey("NEW")}
  END;
  CREATE TRIGGER g2b_opening_result_list_attempt_insert AFTER INSERT ON g2b_collection_attempts
  WHEN NEW.section = 'opening-results' BEGIN
    ${refreshKey("NEW", true)}
  END;
  CREATE TRIGGER g2b_opening_result_list_attempt_delete AFTER DELETE ON g2b_collection_attempts
  WHEN OLD.section = 'opening-results' BEGIN
    ${refreshKey("OLD", true)}
  END;
  CREATE TRIGGER g2b_opening_result_list_attempt_update
  AFTER UPDATE OF id, section, number, revision, opening_revision ON g2b_collection_attempts
  WHEN OLD.section = 'opening-results' OR NEW.section = 'opening-results' BEGIN
    ${refreshKey("OLD", true)}
    ${refreshKey("NEW", true)}
  END;

  ${businessTriggers}
  ${noticeTriggers}
`;
