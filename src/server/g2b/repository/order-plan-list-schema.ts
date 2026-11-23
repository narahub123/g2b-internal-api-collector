import { orderPlanAliasSchema, orderPlanAliasTriggers, orderPlanSourceNumbersSql, orderPlanVisibleAttemptSql, refreshOrderPlanStorage } from "./order-plan-list-links";
import { orderPlanLookupSql, orderPlanUnavailablePredicate } from "./order-plan-notice-sql";

/**
 * 기존 선택지와 같은 업무구분 원본 조합을 만든다.
 * @param data 저장 계획의 원본 JSON을 참조하는 내부 SQL 표현식.
 * @returns 코드와 라벨을 함께 보존하는 SQL 표현식.
 */
function businessPair(data: string) {
  // 표시 규칙에서 기존 정규화를 적용할 수 있도록 원래 값을 보존한다.
  return `json_array(json_extract(${data}, '$.payload.dlOderPlanM.prcmBsneSeCd'), json_extract(${data}, '$.payload.dlOderPlanM.prcmBsneSeCdNm'))`;
}
// 공개일시와 검색에 필요한 파생값을 원본 query_data에서 가져온다.
const savedFields = `p.collected_at, json_extract(p.query_data, '$.fields'), json_extract(p.query_data, '$.fields.released'),
  NULLIF(json_extract(p.query_data, '$.searchTitle'), ''), json_extract(p.query_data, '$.fields.agency'),
  json_extract(p.query_data, '$.fields.budget')`;
// 갱신 대상 목록 번호를 만드는 원래 요청 번호를 인덱스로 찾는다.
const sources = orderPlanSourceNumbersSql("NEW.number");
// 각 요청 번호의 마지막 이력만 읽고 그중 가장 큰 ID를 선택한다.
const latest = `(SELECT MAX((SELECT id FROM g2b_collection_attempts
    WHERE section = 'order-plans' AND number = source_number
      AND revision = NEW.revision AND opening_revision = NEW.opening_revision ORDER BY id DESC LIMIT 1))
    FROM (${sources}))`;

/**
 * 변경된 시도를 현재의 표시 번호와 원래 차수로 목록에 반영한다.
 * @param row 이력의 변경 전 또는 변경 후 별칭.
 * @returns 영향을 받는 하나의 목록 키를 갱신하는 SQL.
 */
function refreshAttempt(row: "OLD" | "NEW") {
  // 다른 업무의 시도와 이력의 상세 상태 변경은 여기서 처리하지 않는다.
  return `INSERT INTO g2b_order_plan_list_refresh
    SELECT COALESCE((SELECT plan_number FROM g2b_order_plan_aliases WHERE lookup_number = ${row}.number), ${row}.number),
      ${row}.revision, ${row}.opening_revision WHERE ${row}.section = 'order-plans';`;
}

/**
 * 저장 계획 하나가 제공하는 선택지의 사용 건수를 반영한다.
 * @param row 변경 전 또는 변경 후의 저장 계획 별칭.
 * @returns 원래 업무구분 조합을 증감하는 SQL.
 */
function changeBusiness(row: "OLD" | "NEW") {
  // 마지막 사용처가 사라진 조합을 제거하고 다른 원본의 기여분은 보존한다.
  if (row === "OLD") {
    return `UPDATE g2b_order_plan_list_businesses SET uses = uses - 1 WHERE pair = ${businessPair("OLD.data")};
      DELETE FROM g2b_order_plan_list_businesses WHERE uses = 0;`;
  }
  // 새 저장 계획의 조합을 새로 등록하거나 이미 있는 조합의 사용 건수에 더한다.
  return `INSERT INTO g2b_order_plan_list_businesses VALUES (${businessPair("NEW.data")}, 1)
    ON CONFLICT(pair) DO UPDATE SET uses = uses + 1;`;
}

// 기존 연결을 계산하고 목록과 기본 집계, 선택지 초기화와 동기화 트리거를 설치한다.
export const orderPlanListSchema = `
  ${orderPlanAliasSchema}
  CREATE TABLE g2b_order_plan_list (
    number TEXT NOT NULL, revision TEXT NOT NULL, opening_revision TEXT NOT NULL,
    collected_at TEXT, fields TEXT, released TEXT, sortTitle TEXT, agency TEXT, budget NUMERIC,
    latest_id INTEGER, visible INTEGER NOT NULL,
    PRIMARY KEY(number, revision, opening_revision)
  ) WITHOUT ROWID;
  CREATE INDEX g2b_order_plan_list_released ON g2b_order_plan_list(released DESC, number, revision, opening_revision)
    WHERE visible = 1;
  CREATE INDEX g2b_order_plan_list_collected ON g2b_order_plan_list(released DESC, number, revision, opening_revision)
    WHERE visible = 1 AND collected_at IS NOT NULL;
  CREATE INDEX g2b_order_plan_list_uncollected ON g2b_order_plan_list(released DESC, number, revision, opening_revision)
    WHERE visible = 1 AND collected_at IS NULL;
  CREATE TABLE g2b_order_plan_list_businesses (
    pair TEXT PRIMARY KEY, uses INTEGER NOT NULL CHECK(uses >= 0)
  ) WITHOUT ROWID;
  CREATE INDEX g2b_order_plan_list_businesses_empty ON g2b_order_plan_list_businesses(uses) WHERE uses = 0;

  -- 이전 목록과 동일한 연결 번호와 차수의 합집합으로 기존 데이터를 초기화한다.
  WITH latest AS MATERIALIZED (
    SELECT COALESCE(a.plan_number, t.number) AS number, t.revision, t.opening_revision, MAX(t.id) AS id
    FROM g2b_collection_attempts t LEFT JOIN g2b_order_plan_aliases a ON a.lookup_number = t.number
    WHERE t.section = 'order-plans' GROUP BY COALESCE(a.plan_number, t.number), t.revision, t.opening_revision
  ), keys AS (
    SELECT number, '' AS revision, '' AS opening_revision FROM order_plans
    UNION SELECT number, revision, opening_revision FROM latest
  )
  INSERT INTO g2b_order_plan_list
    SELECT k.number, k.revision, k.opening_revision, ${savedFields}, latest.id,
      p.number IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM notices WHERE ${orderPlanUnavailablePredicate} AND ${orderPlanLookupSql} = +k.number
      )
    FROM keys k LEFT JOIN order_plans p ON p.number = k.number AND k.revision = '' AND k.opening_revision = ''
    LEFT JOIN latest USING(number, revision, opening_revision);
  INSERT INTO g2b_collection_list_counts(section, scope, total, collected)
    SELECT 'order-plans', 'all', COUNT(*), COUNT(collected_at) FROM g2b_order_plan_list WHERE visible = 1;
  INSERT INTO g2b_order_plan_list_businesses
    SELECT ${businessPair("data")} AS pair, COUNT(*) FROM order_plans GROUP BY pair;

  -- 저장된 행은 항상 노출하므로 수집 건수는 저장 여부로 계산한다.
  CREATE TRIGGER g2b_order_plan_list_count_insert AFTER INSERT ON g2b_order_plan_list WHEN NEW.visible = 1 BEGIN
    UPDATE g2b_collection_list_counts SET total = total + 1, collected = collected + (NEW.collected_at IS NOT NULL)
      WHERE section = 'order-plans' AND scope = 'all';
  END;
  CREATE TRIGGER g2b_order_plan_list_count_delete AFTER DELETE ON g2b_order_plan_list WHEN OLD.visible = 1 BEGIN
    UPDATE g2b_collection_list_counts SET total = total - 1, collected = collected - (OLD.collected_at IS NOT NULL)
      WHERE section = 'order-plans' AND scope = 'all';
  END;
  CREATE TRIGGER g2b_order_plan_list_count_update AFTER UPDATE OF visible, collected_at ON g2b_order_plan_list
  WHEN NEW.visible <> OLD.visible OR (NEW.collected_at IS NULL) <> (OLD.collected_at IS NULL) BEGIN
    UPDATE g2b_collection_list_counts SET total = total + NEW.visible - OLD.visible,
      collected = collected + (NEW.collected_at IS NOT NULL) - (OLD.collected_at IS NOT NULL)
      WHERE section = 'order-plans' AND scope = 'all';
  END;

  -- 표시에 쓰는 복합 키 하나를 갱신하고 저장본과 이력이 없는 키를 제거한다.
  CREATE VIEW g2b_order_plan_list_refresh AS
    SELECT number, revision, opening_revision FROM g2b_order_plan_list WHERE FALSE;
  CREATE TRIGGER g2b_order_plan_list_refresh_key INSTEAD OF INSERT ON g2b_order_plan_list_refresh BEGIN
    INSERT INTO g2b_order_plan_list
    SELECT NEW.number, NEW.revision, NEW.opening_revision, ${savedFields}, ${latest} AS latest_id,
      p.number IS NOT NULL OR ${orderPlanVisibleAttemptSql}
    FROM (SELECT 1) LEFT JOIN order_plans p ON p.number = NEW.number AND NEW.revision = '' AND NEW.opening_revision = ''
    WHERE p.number IS NOT NULL OR latest_id IS NOT NULL
    ON CONFLICT(number, revision, opening_revision) DO UPDATE SET collected_at = excluded.collected_at,
      fields = excluded.fields, released = excluded.released, sortTitle = excluded.sortTitle, agency = excluded.agency,
      budget = excluded.budget, latest_id = excluded.latest_id, visible = excluded.visible;
    DELETE FROM g2b_order_plan_list WHERE number = NEW.number AND revision = NEW.revision AND opening_revision = NEW.opening_revision
      AND NOT EXISTS (SELECT 1 FROM order_plans WHERE number = NEW.number AND NEW.revision = '' AND NEW.opening_revision = '')
      AND NOT EXISTS (SELECT 1 FROM (${sources}) CROSS JOIN g2b_collection_attempts a
        ON a.section = 'order-plans' AND a.number = source_number AND a.revision = NEW.revision AND a.opening_revision = NEW.opening_revision);
  END;

  -- 저장 여부가 바뀌면 정규화 연결을 재평가하고, 같은 저장본의 파생값 변경은 행 하나만 갱신한다.
  CREATE TRIGGER g2b_order_plan_list_saved_insert AFTER INSERT ON order_plans BEGIN
    ${refreshOrderPlanStorage("NEW")}
    ${changeBusiness("NEW")}
  END;
  CREATE TRIGGER g2b_order_plan_list_saved_delete AFTER DELETE ON order_plans BEGIN
    ${refreshOrderPlanStorage("OLD")}
    ${changeBusiness("OLD")}
  END;
  CREATE TRIGGER g2b_order_plan_list_saved_key_update AFTER UPDATE OF number ON order_plans
  WHEN OLD.number IS NOT NEW.number BEGIN
    ${refreshOrderPlanStorage("OLD")}
    ${refreshOrderPlanStorage("NEW")}
  END;
  CREATE TRIGGER g2b_order_plan_list_saved_fields_update AFTER UPDATE OF query_data, collected_at ON order_plans
  WHEN OLD.number IS NEW.number AND (OLD.query_data IS NOT NEW.query_data OR OLD.collected_at IS NOT NEW.collected_at) BEGIN
    INSERT INTO g2b_order_plan_list_refresh VALUES (NEW.number, '', '');
  END;
  CREATE TRIGGER g2b_order_plan_list_business_update AFTER UPDATE OF data ON order_plans
  WHEN ${businessPair("OLD.data")} IS NOT ${businessPair("NEW.data")} BEGIN
    ${changeBusiness("OLD")}
    ${changeBusiness("NEW")}
  END;

  -- 이력의 번호나 최신 순서를 바꿀 수 있는 원본 변경만 목록을 다시 계산한다.
  CREATE TRIGGER g2b_order_plan_list_attempt_insert AFTER INSERT ON g2b_collection_attempts
  WHEN NEW.section = 'order-plans' BEGIN
    ${refreshAttempt("NEW")}
  END;
  CREATE TRIGGER g2b_order_plan_list_attempt_delete AFTER DELETE ON g2b_collection_attempts
  WHEN OLD.section = 'order-plans' BEGIN
    ${refreshAttempt("OLD")}
  END;
  CREATE TRIGGER g2b_order_plan_list_attempt_update
  AFTER UPDATE OF id, section, number, revision, opening_revision ON g2b_collection_attempts
  WHEN OLD.section = 'order-plans' OR NEW.section = 'order-plans' BEGIN
    ${refreshAttempt("OLD")}
    ${refreshAttempt("NEW")}
  END;

  ${orderPlanAliasTriggers}
`;
