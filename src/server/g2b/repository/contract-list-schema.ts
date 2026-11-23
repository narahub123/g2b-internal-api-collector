import { collectionBusinessKeySql } from "./collection-list-query";

// 선택지의 값과 라벨을 함께 보존해 기존 DISTINCT 규칙과 정렬에 사용한다.
const businessPair = `json_array(${collectionBusinessKeySql}, json_extract(b.value, '$.label'))`;
// 기존 계약의 검색과 정렬용 파생값을 추출하되 상세 표시값은 원본에 둔다.
const savedFields = `c.collected_at, json_extract(c.query_data, '$.fields'),
  json_extract(c.query_data, '$.fields.date'), NULLIF(json_extract(c.query_data, '$.searchTitle'), '')`;

/**
 * 계약 한 건이 제공하는 업무구분 조합을 집계에 더하거나 뺀다.
 * @param row 계약 원본의 변경 전 또는 변경 후 행 별칭.
 * @returns 같은 계약 내 중복을 제거하고 사용 건수를 갱신할 SQL.
 */
function updateBusinesses(row: "OLD" | "NEW") {
  // 삭제 시 기존 조합만 차감하고 마지막 사용처가 사라진 행을 제거한다.
  if (row === "OLD") {
    return `UPDATE g2b_contract_list_businesses SET uses = uses - 1
      WHERE pair IN (SELECT ${businessPair} FROM json_each(OLD.query_data, '$.fields.businesses') b);
      DELETE FROM g2b_contract_list_businesses WHERE uses = 0;`;
  }
  // 삽입 시 계약 하나에서 같은 조합이 반복되어도 한 번만 더한다.
  return `INSERT INTO g2b_contract_list_businesses(pair, uses)
    SELECT DISTINCT ${businessPair}, 1 FROM json_each(NEW.query_data, '$.fields.businesses') b WHERE TRUE
    ON CONFLICT(pair) DO UPDATE SET uses = uses + excluded.uses;`;
}

/**
 * 변경된 원본의 키를 계약 목록 갱신 뷰에 전달한다.
 * @param row 변경 전 또는 변경 후 행 별칭.
 * @param attempt 수집 시도 행이면 해당 개찰진행차수를 사용한다.
 * @returns 계약 키 하나의 목록 갱신 SQL.
 */
function refreshKey(row: "OLD" | "NEW", attempt: boolean) {
  // 저장 계약은 빈 개찰진행차수에만 연결하고 수집 시도는 해당 업무의 키만 사용한다.
  return `INSERT INTO g2b_contract_list_refresh
    SELECT ${row}.number, ${row}.revision, ${attempt ? `${row}.opening_revision WHERE ${row}.section = 'contracts'` : "''"};`;
}

// 신규 목록의 초기 데이터를 채우고 이후 원본 변경을 같은 트랜잭션에서 동기화한다.
export const contractListSchema = `
  CREATE TABLE g2b_contract_list (
    number TEXT NOT NULL, revision TEXT NOT NULL, opening_revision TEXT NOT NULL,
    collected_at TEXT, fields TEXT, sortDate TEXT, sortTitle TEXT, latest_id INTEGER,
    PRIMARY KEY(number, revision, opening_revision)
  ) WITHOUT ROWID;
  CREATE INDEX g2b_contract_list_date ON g2b_contract_list(sortDate DESC, number, revision, opening_revision);
  CREATE INDEX g2b_contract_list_collected ON g2b_contract_list(sortDate DESC, number, revision, opening_revision)
    WHERE collected_at IS NOT NULL;
  CREATE INDEX g2b_contract_list_uncollected ON g2b_contract_list(sortDate DESC, number, revision, opening_revision)
    WHERE collected_at IS NULL;
  CREATE TABLE g2b_contract_list_businesses (
    pair TEXT PRIMARY KEY, uses INTEGER NOT NULL CHECK (uses >= 0)
  ) WITHOUT ROWID;
  CREATE INDEX g2b_contract_list_businesses_empty ON g2b_contract_list_businesses(uses) WHERE uses = 0;

  -- 기존 목록과 같은 키 합집합 및 최신 시도를 사용해 초기 목록을 구성한다.
  WITH latest AS MATERIALIZED (
    SELECT number, revision, opening_revision, MAX(id) AS id FROM g2b_collection_attempts
    WHERE section = 'contracts' GROUP BY number, revision, opening_revision
  ), keys AS (
    SELECT number, revision, '' AS opening_revision FROM contracts
    UNION SELECT number, revision, opening_revision FROM latest
  )
  INSERT INTO g2b_contract_list
  SELECT k.number, k.revision, k.opening_revision, ${savedFields}, latest.id
  FROM keys k
  LEFT JOIN contracts c ON k.opening_revision = '' AND c.number = k.number AND c.revision = k.revision
  LEFT JOIN latest USING(number, revision, opening_revision);
  INSERT INTO g2b_collection_list_counts(section, scope, total, collected)
    SELECT 'contracts', 'all', COUNT(*), COUNT(collected_at) FROM g2b_contract_list;
  INSERT INTO g2b_contract_list_businesses
    SELECT pair, COUNT(*) FROM (
      SELECT DISTINCT c.number, c.revision, ${businessPair} AS pair
      FROM contracts c, json_each(c.query_data, '$.fields.businesses') b
    ) GROUP BY pair;

  -- 목록 키의 수와 수집 여부가 바뀔 때만 공통 집계의 계약현황 행을 갱신한다.
  CREATE TRIGGER g2b_contract_list_count_insert AFTER INSERT ON g2b_contract_list BEGIN
    UPDATE g2b_collection_list_counts SET total = total + 1, collected = collected + (NEW.collected_at IS NOT NULL)
      WHERE section = 'contracts' AND scope = 'all';
  END;
  CREATE TRIGGER g2b_contract_list_count_delete AFTER DELETE ON g2b_contract_list BEGIN
    UPDATE g2b_collection_list_counts SET total = total - 1, collected = collected - (OLD.collected_at IS NOT NULL)
      WHERE section = 'contracts' AND scope = 'all';
  END;
  CREATE TRIGGER g2b_contract_list_count_update AFTER UPDATE OF collected_at ON g2b_contract_list
  WHEN (NEW.collected_at IS NULL) <> (OLD.collected_at IS NULL) BEGIN
    UPDATE g2b_collection_list_counts SET collected = collected + (NEW.collected_at IS NOT NULL) - (OLD.collected_at IS NOT NULL)
      WHERE section = 'contracts' AND scope = 'all';
  END;

  -- 키 하나로 저장 계약과 최신 시도를 조회하고 두 원본이 모두 없어진 키를 제거한다.
  CREATE VIEW g2b_contract_list_refresh AS
    SELECT number, revision, opening_revision FROM g2b_contract_list WHERE FALSE;
  CREATE TRIGGER g2b_contract_list_refresh_key INSTEAD OF INSERT ON g2b_contract_list_refresh BEGIN
    INSERT INTO g2b_contract_list
    SELECT NEW.number, NEW.revision, NEW.opening_revision, ${savedFields},
      (SELECT id FROM g2b_collection_attempts WHERE section = 'contracts' AND number = NEW.number
        AND revision = NEW.revision AND opening_revision = NEW.opening_revision ORDER BY id DESC LIMIT 1) AS latest_id
    FROM (SELECT 1) LEFT JOIN contracts c ON NEW.opening_revision = '' AND c.number = NEW.number AND c.revision = NEW.revision
    WHERE c.number IS NOT NULL OR latest_id IS NOT NULL
    ON CONFLICT(number, revision, opening_revision) DO UPDATE SET collected_at = excluded.collected_at,
      fields = excluded.fields, sortDate = excluded.sortDate, sortTitle = excluded.sortTitle, latest_id = excluded.latest_id;
    DELETE FROM g2b_contract_list WHERE number = NEW.number AND revision = NEW.revision
      AND opening_revision = NEW.opening_revision
      AND NOT EXISTS (SELECT 1 FROM contracts WHERE NEW.opening_revision = '' AND number = NEW.number AND revision = NEW.revision)
      AND NOT EXISTS (SELECT 1 FROM g2b_collection_attempts WHERE section = 'contracts' AND number = NEW.number
        AND revision = NEW.revision AND opening_revision = NEW.opening_revision);
  END;

  -- 원본 계약 변경은 목록과 선택지에 반영한다. 같은 선택지가 유지되는 갱신은 집계를 건너뛴다.
  CREATE TRIGGER g2b_contract_list_saved_insert AFTER INSERT ON contracts BEGIN
    ${refreshKey("NEW", false)}
    ${updateBusinesses("NEW")}
  END;
  CREATE TRIGGER g2b_contract_list_saved_delete AFTER DELETE ON contracts BEGIN
    ${refreshKey("OLD", false)}
    ${updateBusinesses("OLD")}
  END;
  CREATE TRIGGER g2b_contract_list_saved_update AFTER UPDATE OF number, revision, query_data, collected_at ON contracts
  WHEN OLD.number IS NOT NEW.number OR OLD.revision IS NOT NEW.revision
    OR OLD.query_data IS NOT NEW.query_data OR OLD.collected_at IS NOT NEW.collected_at BEGIN
    INSERT INTO g2b_contract_list_refresh SELECT OLD.number, OLD.revision, ''
      WHERE OLD.number IS NOT NEW.number OR OLD.revision IS NOT NEW.revision;
    ${refreshKey("NEW", false)}
  END;
  CREATE TRIGGER g2b_contract_list_business_update AFTER UPDATE OF query_data ON contracts
  WHEN json_extract(OLD.query_data, '$.fields.businesses') IS NOT json_extract(NEW.query_data, '$.fields.businesses') BEGIN
    ${updateBusinesses("OLD")}
    ${updateBusinesses("NEW")}
  END;

  -- 최신 ID에 영향을 주는 수집 시도만 목록 키를 갱신한다. 상태와 진단은 페이지에서 원본을 읽는다.
  CREATE TRIGGER g2b_contract_list_attempt_insert AFTER INSERT ON g2b_collection_attempts
  WHEN NEW.section = 'contracts' BEGIN
    ${refreshKey("NEW", true)}
  END;
  CREATE TRIGGER g2b_contract_list_attempt_delete AFTER DELETE ON g2b_collection_attempts
  WHEN OLD.section = 'contracts' BEGIN
    ${refreshKey("OLD", true)}
  END;
  CREATE TRIGGER g2b_contract_list_attempt_update
  AFTER UPDATE OF id, section, number, revision, opening_revision ON g2b_collection_attempts
  WHEN OLD.section = 'contracts' OR NEW.section = 'contracts' BEGIN
    ${refreshKey("OLD", true)}
    ${refreshKey("NEW", true)}
  END;
`;
