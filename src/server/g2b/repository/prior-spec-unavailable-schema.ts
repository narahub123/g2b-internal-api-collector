import { priorSpecUnavailableStatus } from "@/shared/config/g2b-prior-spec";

// 기존 조회와 같은 공백 목록으로 JavaScript trim의 처리 범위를 유지한다.
const trimChars = "char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)";

/**
 * 기존 공고 조회와 같은 우선순위로 조회 불가 사전규격 번호를 선택한다.
 * @param data 유효성을 확인하기 전의 입찰공고 원본 SQL 표현식.
 * @returns 조회 불가 연결 번호 또는 해당 연결이 없을 때 NULL을 계산하는 SQL.
 */
function unavailableNumber(data: string) {
  // 두 경로의 문자열만 공백 제거 후 검사하고 첫 유효 번호를 선택한다.
  const paths = ["$.payload.dmItemMap.bfSpecRegNo", "$.payload.dlBfSpecM.bfSpecRegNo"];
  const candidates = paths.map((path) => {
    // 숫자형 JSON 등의 값은 원본 등록번호로 사용하지 않는다.
    const candidate = `trim(json_extract(${data}, '${path}'), ${trimChars})`;
    return `CASE WHEN json_type(${data}, '${path}') = 'text' AND length(${candidate}) BETWEEN 1 AND 30
      AND ${candidate} NOT GLOB '*[^A-Z0-9-]*' AND instr(${candidate}, char(0)) = 0 THEN ${candidate} END`;
  });
  // 잘못된 JSON의 경로를 평가하지 않고 기존 조회 불가 상태만 포함한다.
  return `CASE WHEN json_valid(${data}) THEN CASE WHEN json_extract(${data}, '$.priorSpecStatus') = '${priorSpecUnavailableStatus}'
    THEN COALESCE(${candidates.join(", ")}) END END`;
}

/**
 * 저장 여부와 조회 불가 연결에 따른 목록 노출 여부를 계산한다.
 * @param number 사전규격 목록 키의 번호 SQL 표현식.
 * @returns 저장 행이 있거나 조회 불가 연결이 없을 때 참이 되는 SQL.
 */
export function priorSpecVisibilitySql(number: string) {
  // 저장본은 노출하고 시도만 있는 키는 번호 인덱스로 조회 불가 연결의 존재 여부를 확인한다.
  return `(c.collected_at IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM g2b_prior_spec_unavailable_links WHERE spec_number = ${number}
  ))`;
}

// 공고 키별 조회 불가 연결을 저장하고 사전규격 번호로 연결을 탐색할 인덱스를 만든다.
export const unavailableMappingSchema = `
  CREATE TABLE g2b_prior_spec_unavailable_links (
    notice_number TEXT NOT NULL, notice_revision TEXT NOT NULL, spec_number TEXT NOT NULL,
    PRIMARY KEY(notice_number, notice_revision)
  ) WITHOUT ROWID;
  CREATE INDEX g2b_prior_spec_unavailable_number ON g2b_prior_spec_unavailable_links(spec_number);
  INSERT INTO g2b_prior_spec_unavailable_links
    SELECT number, revision, spec_number FROM (
      SELECT number, revision, ${unavailableNumber("data")} AS spec_number FROM notices
      WHERE CASE WHEN json_valid(data)
        THEN json_extract(data, '$.priorSpecStatus') = '${priorSpecUnavailableStatus}' END
    ) WHERE spec_number IS NOT NULL;
`;

// 변경된 공고만 등록하거나 이전 연결을 제거할 때 사용하는 새 번호 표현식이다.
const newNumber = unavailableNumber("NEW.data");
// 변경 이후 조회 불가 연결이 있는 경우에만 해당 공고 키를 추가한다.
const insertLink = `INSERT INTO g2b_prior_spec_unavailable_links
  SELECT NEW.number, NEW.revision, spec_number FROM (SELECT ${newNumber} AS spec_number)
  WHERE spec_number IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM g2b_prior_spec_unavailable_links
      WHERE notice_number = NEW.number AND notice_revision = NEW.revision);`;

// 첫 연결과 마지막 연결만 대상 번호의 미수집 키에 반영한다.
export const unavailableMappingTriggers = `
  CREATE TRIGGER g2b_prior_spec_unavailable_link_insert AFTER INSERT ON g2b_prior_spec_unavailable_links
  WHEN NOT EXISTS (SELECT 1 FROM g2b_prior_spec_unavailable_links WHERE spec_number = NEW.spec_number
    AND (notice_number <> NEW.notice_number OR notice_revision <> NEW.notice_revision)) BEGIN
    UPDATE g2b_prior_spec_list SET visible = 0
      WHERE number = NEW.spec_number AND collected_at IS NULL AND visible = 1;
  END;
  CREATE TRIGGER g2b_prior_spec_unavailable_link_delete AFTER DELETE ON g2b_prior_spec_unavailable_links
  WHEN NOT EXISTS (SELECT 1 FROM g2b_prior_spec_unavailable_links WHERE spec_number = OLD.spec_number) BEGIN
    UPDATE g2b_prior_spec_list SET visible = 1
      WHERE number = OLD.spec_number AND collected_at IS NULL AND visible = 0;
  END;
  CREATE TRIGGER g2b_prior_spec_unavailable_notice_insert AFTER INSERT ON notices
  WHEN ${newNumber} IS NOT NULL BEGIN
    ${insertLink}
  END;
  CREATE TRIGGER g2b_prior_spec_unavailable_notice_delete AFTER DELETE ON notices
  WHEN ${unavailableNumber("OLD.data")} IS NOT NULL BEGIN
    DELETE FROM g2b_prior_spec_unavailable_links WHERE notice_number = OLD.number AND notice_revision = OLD.revision;
  END;
  CREATE TRIGGER g2b_prior_spec_unavailable_notice_update AFTER UPDATE OF number, revision, data ON notices
  WHEN (OLD.data IS NOT NEW.data OR OLD.number IS NOT NEW.number OR OLD.revision IS NOT NEW.revision)
    AND (${unavailableNumber("OLD.data")} IS NOT NULL OR ${newNumber} IS NOT NULL) BEGIN
    DELETE FROM g2b_prior_spec_unavailable_links WHERE notice_number = OLD.number AND notice_revision = OLD.revision
      AND (OLD.number IS NOT NEW.number OR OLD.revision IS NOT NEW.revision OR spec_number IS NOT ${newNumber});
    ${insertLink}
  END;
`;
