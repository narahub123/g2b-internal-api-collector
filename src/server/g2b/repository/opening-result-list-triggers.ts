import { collectionBusinessKeySql } from "./collection-list-query";

// 표시용 사업 구분과 별도로 검색·필터에서 사용하던 연결 공고 우선순위를 유지한다.
export const openingListFields = `CASE WHEN c.query_data IS NULL THEN NULL ELSE json_set(
  json_extract(c.query_data, '$.fields'),
  '$.businesses', json(COALESCE(
    CASE WHEN json_extract(n.query_data, '$.linkedCode') IS NULL THEN json_extract(c.query_data, '$.singleBusiness') END,
    json_extract(n.query_data, '$.linkedBusiness'), json_extract(c.query_data, '$.fields.businesses')
  )),
  '$.agencies', CASE WHEN json_array_length(c.query_data, '$.fields.agencies') = 0
    AND COALESCE(json_extract(n.query_data, '$.linkedAgency'), '') <> ''
    THEN json_array(json_extract(n.query_data, '$.linkedAgency'))
    ELSE json_extract(c.query_data, '$.fields.agencies') END
) END`;

// 개찰진행차수별로 사용 중인 값과 라벨의 조합을 함께 보존한다.
export const openingBusinessPair = `json_array(${collectionBusinessKeySql}, json_extract(b.value, '$.label'))`;

/**
 * 수집된 개찰진행차수가 기여하는 업무구분 조합만 선택한다.
 * @param row 목록 행의 변경 전 또는 변경 후 별칭.
 * @param previous 변경 시 반대 방향의 행으로 양쪽에 있는 조합을 상쇄한다.
 * @returns 수집된 행의 중복 없는 조합 또는 미수집 행의 빈 집합을 반환하는 SQL.
 */
function pairs(row: "OLD" | "NEW", previous?: "OLD" | "NEW") {
  // 수집 상태를 양쪽에 독립적으로 적용해야 업무구분이 그대로인 수집 전환도 반영된다.
  const query = `SELECT DISTINCT ${openingBusinessPair} AS pair FROM json_each(${row}.fields, '$.businesses') b
    WHERE ${row}.collected_at IS NOT NULL`;
  // 변경 전후 모두 기여하는 조합은 차집합에서 제외해 기존 사용 건수를 유지한다.
  return previous ? `${query} EXCEPT SELECT ${openingBusinessPair} FROM json_each(${previous}.fields, '$.businesses') b
    WHERE ${previous}.collected_at IS NOT NULL` : query;
}

// 전후 차집합에 대해서만 사용 건수를 증감하며 마지막 사용처를 잃은 조합을 삭제한다.
export const businessTriggers = `
  CREATE TRIGGER g2b_opening_result_list_business_insert AFTER INSERT ON g2b_opening_result_list
  WHEN NEW.collected_at IS NOT NULL BEGIN
    INSERT INTO g2b_opening_result_list_businesses(pair, uses)
      SELECT pair, 1 FROM (${pairs("NEW")}) WHERE TRUE
      ON CONFLICT(pair) DO UPDATE SET uses = uses + 1;
  END;
  CREATE TRIGGER g2b_opening_result_list_business_delete AFTER DELETE ON g2b_opening_result_list
  WHEN OLD.collected_at IS NOT NULL BEGIN
    UPDATE g2b_opening_result_list_businesses SET uses = uses - 1 WHERE pair IN (${pairs("OLD")});
    DELETE FROM g2b_opening_result_list_businesses WHERE uses = 0;
  END;
  CREATE TRIGGER g2b_opening_result_list_business_update
  AFTER UPDATE OF collected_at, fields ON g2b_opening_result_list
  WHEN (OLD.collected_at IS NULL) <> (NEW.collected_at IS NULL)
    OR (NEW.collected_at IS NOT NULL
      AND json_extract(OLD.fields, '$.businesses') IS NOT json_extract(NEW.fields, '$.businesses')) BEGIN
    UPDATE g2b_opening_result_list_businesses SET uses = uses - 1 WHERE pair IN (${pairs("OLD", "NEW")});
    DELETE FROM g2b_opening_result_list_businesses WHERE uses = 0;
    INSERT INTO g2b_opening_result_list_businesses(pair, uses)
      SELECT pair, 1 FROM (${pairs("NEW", "OLD")}) WHERE TRUE
      ON CONFLICT(pair) DO UPDATE SET uses = uses + 1;
  END;
`;

/**
 * 공고 키에 연결된 저장 개찰결과만 기본 키 범위로 조회해 다시 계산한다.
 * @param row 입찰공고의 변경 전 또는 변경 후 별칭.
 * @param condition 키 변경 여부 등 선택 범위에 추가하는 저장소 SQL 조건.
 * @returns 연결된 개찰진행차수의 갱신 SQL.
 */
function refreshNotice(row: "OLD" | "NEW", condition = "TRUE") {
  // 공고 번호·차수 접두사로 원본을 찾으므로 다른 공고와 시도 전용 키는 갱신하지 않는다.
  return `INSERT INTO g2b_opening_result_list_refresh
    SELECT number, revision, opening_revision FROM opening_results
    WHERE number = ${row}.number AND revision = ${row}.revision AND (${condition});`;
}

// 공고의 유효성 또는 실제 검색·필터 입력이 바뀌었는지 확인하는 SQL 조건이다.
const changedNoticeFields = ["openingSearchTitle", "linkedAgency", "linkedCode", "linkedBusiness"].map((field) =>
  `(CASE WHEN json_valid(OLD.data) THEN json_extract(OLD.query_data, '$.${field}') END) IS NOT
   (CASE WHEN json_valid(NEW.data) THEN json_extract(NEW.query_data, '$.${field}') END)`,
).join(" OR ");
// 공고 키가 바뀌면 이전 키에서 연결을 제거하고 새 키에 연결한다.
const changedNoticeKey = "OLD.number IS NOT NEW.number OR OLD.revision IS NOT NEW.revision";

// 연결값이 바뀌면 원본 공고와 같은 트랜잭션에서 해당 저장 결과만 갱신한다.
export const noticeTriggers = `
  CREATE TRIGGER g2b_opening_result_list_notice_insert AFTER INSERT ON notices
  WHEN json_valid(NEW.data) BEGIN
    ${refreshNotice("NEW")}
  END;
  CREATE TRIGGER g2b_opening_result_list_notice_delete AFTER DELETE ON notices
  WHEN json_valid(OLD.data) BEGIN
    ${refreshNotice("OLD")}
  END;
  CREATE TRIGGER g2b_opening_result_list_notice_update AFTER UPDATE OF number, revision, data, query_data ON notices
  WHEN (${changedNoticeKey}) OR (${changedNoticeFields}) BEGIN
    ${refreshNotice("OLD", changedNoticeKey)}
    ${refreshNotice("NEW")}
  END;
`;
