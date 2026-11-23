// 저장 공고의 업무구분 코드와 라벨은 기존 선택지의 원본 우선순위를 따른다.
const businessCode = "COALESCE(json_extract(data, '$.payload.dlUntyBidPbancM.prcmBsneSeCd'), json_extract(data, '$.payload.dmItemMap.prcmBsneSeCd'))";
const businessLabel = "json_extract(data, '$.payload.dmItemMap.prcmBsneSeNm')";

/**
 * 저장 공고 하나가 제공하는 중복 없는 선택지를 생성한다.
 * @param source 마이그레이션 내부에서 지정한 공고 원본 조회문.
 * @returns 관리자 및 사용자 선택지의 종류, 값과 사용자 노출 여부를 반환하는 SQL.
 */
function optionRows(source: string) {
  // 사용자 선택지는 기존처럼 명시적으로 모의공고가 아닌 유효한 원본에서만 가져온다.
  const visible = "CASE WHEN json_extract(query_data, '$.mock') = 0 THEN 1 ELSE 0 END";
  // 선택지 종류마다 원본 JSON 경로를 유지하고 공고 하나에서 같은 지역이 반복되는 경우 한 번만 센다.
  return `SELECT DISTINCT number, revision, 'region' AS kind, json_quote(region.value) AS value, ${visible} AS visible
    FROM (${source}), json_each(query_data, '$.regionOptions') region
    WHERE CASE WHEN json_valid(data) THEN json_extract(data, '$.payload.dmItemMap.rgnLmtYn') = 'Y' END
    UNION ALL
    SELECT number, revision, 'business', json_array(${businessCode}, ${businessLabel}), ${visible}
    FROM (${source}) WHERE json_valid(data)`;
}

/**
 * 원본 행 하나의 선택지 사용 건수를 늘리거나 줄인다.
 * @param row 변경 전 또는 변경 후의 공고 원본 행 별칭.
 * @returns 원본과 같은 트랜잭션에서 집계에 적용할 SQL.
 */
function updateOptions(row: "OLD" | "NEW") {
  // 집계에서 해당 공고의 기여분을 더하거나 빼고, 아무 공고도 사용하지 않는 선택지는 제거한다.
  const delta = row === "NEW" ? 1 : -1;
  const rows = optionRows(`SELECT ${row}.number AS number, ${row}.revision AS revision, ${row}.data AS data, ${row}.query_data AS query_data`);
  return `INSERT INTO g2b_notice_list_options (kind, value, total, visible)
    SELECT kind, value, ${delta}, ${delta} * visible FROM (${rows}) WHERE TRUE
    ON CONFLICT(kind, value) DO UPDATE SET total = total + excluded.total, visible = visible + excluded.visible;
    DELETE FROM g2b_notice_list_options WHERE total = 0;`;
}

/**
 * 원본 트리거에서 지정한 공고 키를 목록 갱신 뷰에 전달한다.
 * @param row 원본의 변경 전 또는 변경 후 행 별칭.
 * @param attempt 수집 시도 행이면 자체 개찰차수를 사용한다.
 * @returns 공고 키 하나의 갱신을 요청하는 SQL.
 */
function refreshKey(row: "OLD" | "NEW", attempt: boolean) {
  // 저장 공고는 개찰차수가 없는 키에만 연결하며, 다른 업무의 수집 시도는 건너뛴다.
  return `INSERT INTO g2b_notice_list_refresh
    SELECT ${row}.number, ${row}.revision, ${attempt ? `${row}.opening_revision WHERE ${row}.section = 'notices'` : "''"};`;
}

// 유효한 원본 공고의 기존 검색 필드를 재사용하고 자주 정렬하는 값은 목록에 직접 저장한다.
const savedFields = `n.collected_at, COALESCE(json_extract(n.query_data, '$.mock'), 0),
  json_extract(n.query_data, '$.fields'), json_extract(n.query_data, '$.fields.posted')`;

// 원본과 목록의 변경을 같은 DB 트랜잭션에 포함시키는 스키마 및 초기 집계다.
export const noticeListSchema = `
  CREATE TABLE g2b_notice_list (
    number TEXT NOT NULL, revision TEXT NOT NULL, opening_revision TEXT NOT NULL,
    collected_at TEXT, is_mock INTEGER NOT NULL, fields TEXT, posted TEXT, latest_id INTEGER,
    PRIMARY KEY(number, revision, opening_revision)
  ) WITHOUT ROWID;
  CREATE INDEX g2b_notice_list_posted ON g2b_notice_list(posted DESC, number, revision, opening_revision);
  CREATE INDEX g2b_notice_list_collected ON g2b_notice_list(posted DESC, number, revision, opening_revision)
    WHERE collected_at IS NOT NULL;
  CREATE INDEX g2b_notice_list_public ON g2b_notice_list(posted DESC, number, revision, opening_revision)
    WHERE collected_at IS NOT NULL AND is_mock = 0;
  CREATE INDEX g2b_notice_list_uncollected ON g2b_notice_list(posted DESC, number, revision, opening_revision)
    WHERE collected_at IS NULL;
  CREATE TABLE g2b_notice_list_counts (
    id INTEGER PRIMARY KEY CHECK(id = 1), total INTEGER NOT NULL, collected INTEGER NOT NULL,
    public_total INTEGER NOT NULL, public_collected INTEGER NOT NULL
  );
  CREATE TABLE g2b_notice_list_options (
    kind TEXT NOT NULL, value TEXT NOT NULL, total INTEGER NOT NULL, visible INTEGER NOT NULL,
    PRIMARY KEY(kind, value)
  ) WITHOUT ROWID;
  CREATE INDEX g2b_notice_list_options_empty ON g2b_notice_list_options(total) WHERE total = 0;

  -- 수집 이력은 최초 한 번만 그룹화한다. 그 이후에는 원본 트리거가 변경 키만 갱신한다.
  WITH latest AS MATERIALIZED (
    SELECT number, revision, opening_revision, MAX(id) AS id
    FROM g2b_collection_attempts WHERE section = 'notices' GROUP BY number, revision, opening_revision
  ), keys AS (
    SELECT number, revision, '' AS opening_revision FROM notices WHERE json_valid(data)
    UNION SELECT number, revision, opening_revision FROM latest
  )
  INSERT INTO g2b_notice_list
  SELECT k.number, k.revision, k.opening_revision, ${savedFields}, a.id
  FROM keys k
  LEFT JOIN notices n ON k.opening_revision = '' AND n.number = k.number AND n.revision = k.revision AND json_valid(n.data)
  LEFT JOIN latest a USING(number, revision, opening_revision);
  INSERT INTO g2b_notice_list_counts
  SELECT 1, COUNT(*), COUNT(collected_at), COUNT(*) FILTER (WHERE is_mock = 0),
    COUNT(collected_at) FILTER (WHERE is_mock = 0)
  FROM g2b_notice_list;
  INSERT INTO g2b_notice_list_options
  SELECT kind, value, COUNT(*), SUM(visible)
  FROM (${optionRows("SELECT number, revision, data, query_data FROM notices")}) GROUP BY kind, value;

  -- 목록에서 키 또는 공개 범위가 바뀔 때 기본 화면 집계에 차이를 반영한다.
  CREATE TRIGGER g2b_notice_list_count_insert AFTER INSERT ON g2b_notice_list BEGIN
    UPDATE g2b_notice_list_counts SET total = total + 1, collected = collected + (NEW.collected_at IS NOT NULL),
      public_total = public_total + (NEW.is_mock = 0),
      public_collected = public_collected + (NEW.is_mock = 0 AND NEW.collected_at IS NOT NULL);
  END;
  CREATE TRIGGER g2b_notice_list_count_delete AFTER DELETE ON g2b_notice_list BEGIN
    UPDATE g2b_notice_list_counts SET total = total - 1, collected = collected - (OLD.collected_at IS NOT NULL),
      public_total = public_total - (OLD.is_mock = 0),
      public_collected = public_collected - (OLD.is_mock = 0 AND OLD.collected_at IS NOT NULL);
  END;
  CREATE TRIGGER g2b_notice_list_count_update AFTER UPDATE OF collected_at, is_mock ON g2b_notice_list
  WHEN (NEW.collected_at IS NULL) <> (OLD.collected_at IS NULL) OR NEW.is_mock IS NOT OLD.is_mock BEGIN
    UPDATE g2b_notice_list_counts SET collected = collected + (NEW.collected_at IS NOT NULL) - (OLD.collected_at IS NOT NULL),
      public_total = public_total + (NEW.is_mock = 0) - (OLD.is_mock = 0),
      public_collected = public_collected + (NEW.is_mock = 0 AND NEW.collected_at IS NOT NULL)
        - (OLD.is_mock = 0 AND OLD.collected_at IS NOT NULL);
  END;

  -- 원본 트리거가 같은 계산을 재사용하도록 키만 받는 쓰기용 뷰를 둔다.
  CREATE VIEW g2b_notice_list_refresh AS
    SELECT number, revision, opening_revision FROM g2b_notice_list WHERE FALSE;
  CREATE TRIGGER g2b_notice_list_refresh_key INSTEAD OF INSERT ON g2b_notice_list_refresh BEGIN
    INSERT INTO g2b_notice_list
    SELECT NEW.number, NEW.revision, NEW.opening_revision, ${savedFields},
      (SELECT id FROM g2b_collection_attempts WHERE section = 'notices' AND number = NEW.number
        AND revision = NEW.revision AND opening_revision = NEW.opening_revision ORDER BY id DESC LIMIT 1) AS latest_id
    FROM (SELECT 1) LEFT JOIN notices n ON NEW.opening_revision = '' AND n.number = NEW.number
      AND n.revision = NEW.revision AND json_valid(n.data)
    WHERE n.number IS NOT NULL OR latest_id IS NOT NULL
    ON CONFLICT(number, revision, opening_revision) DO UPDATE SET collected_at = excluded.collected_at,
      is_mock = excluded.is_mock, fields = excluded.fields, posted = excluded.posted, latest_id = excluded.latest_id;
    DELETE FROM g2b_notice_list WHERE number = NEW.number AND revision = NEW.revision
      AND opening_revision = NEW.opening_revision
      AND NOT EXISTS (SELECT 1 FROM notices WHERE NEW.opening_revision = '' AND number = NEW.number
        AND revision = NEW.revision AND json_valid(data))
      AND NOT EXISTS (SELECT 1 FROM g2b_collection_attempts WHERE section = 'notices' AND number = NEW.number
        AND revision = NEW.revision AND opening_revision = NEW.opening_revision);
  END;
  CREATE TRIGGER g2b_notice_list_saved_insert AFTER INSERT ON notices BEGIN
    ${refreshKey("NEW", false)}
    ${updateOptions("NEW")}
  END;
  CREATE TRIGGER g2b_notice_list_saved_delete AFTER DELETE ON notices BEGIN
    ${refreshKey("OLD", false)}
    ${updateOptions("OLD")}
  END;
  CREATE TRIGGER g2b_notice_list_saved_update AFTER UPDATE OF number, revision, data, query_data, collected_at ON notices BEGIN
    INSERT INTO g2b_notice_list_refresh SELECT OLD.number, OLD.revision, ''
      WHERE OLD.number <> NEW.number OR OLD.revision <> NEW.revision;
    ${refreshKey("NEW", false)}
    ${updateOptions("OLD")}
    ${updateOptions("NEW")}
  END;
  CREATE TRIGGER g2b_notice_list_attempt_insert AFTER INSERT ON g2b_collection_attempts
  WHEN NEW.section = 'notices' BEGIN
    ${refreshKey("NEW", true)}
  END;
  CREATE TRIGGER g2b_notice_list_attempt_delete AFTER DELETE ON g2b_collection_attempts
  WHEN OLD.section = 'notices' BEGIN
    ${refreshKey("OLD", true)}
  END;
  CREATE TRIGGER g2b_notice_list_attempt_update
  AFTER UPDATE OF id, section, number, revision, opening_revision ON g2b_collection_attempts
  WHEN OLD.section = 'notices' OR NEW.section = 'notices' BEGIN
    ${refreshKey("OLD", true)}
    ${refreshKey("NEW", true)}
  END;
`;
