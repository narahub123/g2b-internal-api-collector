import { orderPlanLinkPredicate, orderPlanLookupSql, orderPlanNumberSql, orderPlanUnavailablePredicate } from "./order-plan-notice-sql";

/**
 * 저장 번호에 합쳐지는 원래 요청 번호를 인덱스로 찾는다.
 * @param number 조회할 목록 번호를 나타내는 내부 SQL 표현식.
 * @param from 호출자가 제공하는 선택적 대상 행 SQL.
 * @returns 원래 번호와 해당 번호를 가리키는 별칭을 반환하는 SQL.
 */
export function orderPlanSourceNumbersSql(number: string, from = "") {
  // 요청 번호가 다른 계획에 합쳐져 있으면 현재 번호의 독립 이력에서 제외한다.
  return `SELECT ${number} AS source_number ${from}
    WHERE NOT EXISTS (SELECT 1 FROM g2b_order_plan_aliases WHERE lookup_number = ${number})
    UNION ALL SELECT a.lookup_number ${from || "FROM (SELECT 1)"}
      CROSS JOIN g2b_order_plan_aliases a ON a.plan_number = ${number}`;
}

// 공고의 연결과 조회 불가 여부를 기존 표현식 인덱스의 조건으로 읽는다.
export const orderPlanVisibleAttemptSql = `NOT EXISTS (
  SELECT 1 FROM notices WHERE ${orderPlanUnavailablePredicate} AND ${orderPlanLookupSql} = +NEW.number
)`;

// 양방향으로 영향받는 번호만 찾도록 기존 인덱스에 저장 번호 방향을 추가한다.
export const orderPlanAliasSchema = `
  CREATE INDEX g2b_notice_order_plan_reverse_link ON notices (${orderPlanNumberSql}, ${orderPlanLookupSql})
    WHERE ${orderPlanLinkPredicate};
  CREATE TABLE g2b_order_plan_aliases (
    lookup_number TEXT PRIMARY KEY, plan_number TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX g2b_order_plan_aliases_reverse ON g2b_order_plan_aliases(plan_number);

  -- 초기 연결은 이전 조회와 같이 하나의 다른 저장 계획을 가리키는 경우만 추가한다.
  INSERT INTO g2b_order_plan_aliases
    SELECT links.lookup_number, links.plan_number FROM (
      SELECT ${orderPlanLookupSql} AS lookup_number, MIN(${orderPlanNumberSql}) AS plan_number
      FROM notices WHERE ${orderPlanLinkPredicate} GROUP BY ${orderPlanLookupSql}
      HAVING MIN(${orderPlanNumberSql}) = MAX(${orderPlanNumberSql}) AND plan_number <> lookup_number
    ) links JOIN order_plans saved ON saved.number = links.plan_number
    WHERE NOT EXISTS (SELECT 1 FROM order_plans WHERE number = links.lookup_number);
`;

/**
 * 변경된 번호의 후보 연결을 기존 인덱스에서 한 건씩 가져온다.
 * @param direction 후보의 처음 또는 마지막을 선택할 정렬 방향.
 * @returns 연결 후보의 경계만 확인하는 SQL.
 */
function linkBound(direction: "ASC" | "DESC") {
  // JSON 표현식의 값과 같은 타입으로 비교해 양 끝을 인덱스에서 직접 읽는다.
  return `(SELECT ${orderPlanNumberSql} FROM notices WHERE ${orderPlanLinkPredicate}
    AND ${orderPlanLookupSql} = +NEW.lookup_number ORDER BY ${orderPlanNumberSql} ${direction} LIMIT 1)`;
}

/**
 * 별칭이 이동할 때 동일 요청 번호의 시도 차수만 다시 계산한다.
 * @param lookup 원래 요청 번호를 나타내는 내부 SQL 표현식.
 * @param destinations 변경 전후에 영향을 받는 목록 번호를 반환하는 SQL.
 * @returns 영향받는 복합 키들을 전용 목록의 갱신 뷰에 전달하는 SQL.
 */
function refreshAliasKeys(lookup: string, destinations: string) {
  // 전체 이력 대신 원래 번호의 차수만 중복 제거한 뒤 재계산 대상 번호와 결합한다.
  return `INSERT INTO g2b_order_plan_list_refresh
    SELECT DISTINCT d.number, a.revision, a.opening_revision FROM (${destinations}) d
    CROSS JOIN g2b_collection_attempts a ON a.section = 'order-plans' AND a.number = ${lookup};`;
}

/**
 * 발주계획 저장·삭제에 영향을 받는 요청 번호 및 저장 행을 갱신한다.
 * @param row 저장 원본의 변경 전 또는 변경 후 별칭.
 * @returns 번호 연결을 반영한 후 빈 차수의 저장 행을 갱신하는 SQL.
 */
export function refreshOrderPlanStorage(row: "OLD" | "NEW") {
  // 자신의 저장 여부와 자신을 가리키는 모든 연결 후보를 역방향 인덱스로 찾는다.
  return `INSERT INTO g2b_order_plan_alias_refresh
    SELECT ${row}.number UNION SELECT ${orderPlanLookupSql} FROM notices
    WHERE ${orderPlanLinkPredicate} AND ${orderPlanNumberSql} = +${row}.number;
    INSERT INTO g2b_order_plan_list_refresh VALUES (${row}.number, '', '');`;
}

/**
 * 공고 변경으로 영향을 받을 번호와 상태를 파악한다.
 * @param row 공고 원본의 변경 전 또는 변경 후 별칭.
 * @returns 이전 인덱스의 조건과 같은 규칙으로 계산한 입력 SQL.
 */
function orderPlanNoticeInput(row: "OLD" | "NEW") {
  // 원본 행을 별칭 없는 내부 조회로 만들어 기존 JSON 조건을 그대로 실행한다.
  const input = `FROM (SELECT ${row}.data AS data, ${row}.query_data AS query_data)`;
  // 연결이나 조회 불가 판정 중 하나라도 유효한 공고만 요청 번호를 제공한다.
  const lookup = `(SELECT ${orderPlanLookupSql} ${input} WHERE ${orderPlanLinkPredicate} OR (${orderPlanUnavailablePredicate}))`;
  // 유효한 연결과 조회 불가 상태를 별도로 비교해 변경 내용을 구분한다.
  const plan = `(SELECT ${orderPlanNumberSql} ${input} WHERE ${orderPlanLinkPredicate})`;
  const unavailable = `(SELECT 1 ${input} WHERE ${orderPlanUnavailablePredicate})`;
  // 트리거가 이전과 이후의 영향 범위를 비교하는 표현식들을 반환한다.
  return { lookup, plan, unavailable };
}

// 이전 입력과 새 입력의 차이를 검사해 관련 없는 공고 갱신은 건너뛴다.
const oldNotice = orderPlanNoticeInput("OLD");
const newNotice = orderPlanNoticeInput("NEW");

// 별칭 및 조회 불가 판정은 원본 변경과 같은 트랜잭션에서 동기화한다.
export const orderPlanAliasTriggers = `
  CREATE VIEW g2b_order_plan_alias_apply AS SELECT lookup_number, plan_number FROM g2b_order_plan_aliases WHERE FALSE;
  CREATE TRIGGER g2b_order_plan_alias_apply_key INSTEAD OF INSERT ON g2b_order_plan_alias_apply BEGIN
    DELETE FROM g2b_order_plan_aliases WHERE lookup_number = NEW.lookup_number AND NEW.plan_number IS NULL;
    INSERT INTO g2b_order_plan_aliases SELECT NEW.lookup_number, NEW.plan_number WHERE NEW.plan_number IS NOT NULL
      ON CONFLICT(lookup_number) DO UPDATE SET plan_number = excluded.plan_number
      WHERE plan_number IS NOT excluded.plan_number;
  END;
  CREATE VIEW g2b_order_plan_alias_refresh AS SELECT lookup_number FROM g2b_order_plan_aliases WHERE FALSE;
  CREATE TRIGGER g2b_order_plan_alias_refresh_key INSTEAD OF INSERT ON g2b_order_plan_alias_refresh BEGIN
    INSERT INTO g2b_order_plan_alias_apply
      SELECT NEW.lookup_number, (
        SELECT saved.number FROM (SELECT ${linkBound("ASC")} AS first_plan, ${linkBound("DESC")} AS last_plan) bounds
        JOIN order_plans saved ON saved.number = bounds.first_plan
        WHERE bounds.first_plan = bounds.last_plan AND saved.number <> NEW.lookup_number
          AND NOT EXISTS (SELECT 1 FROM order_plans WHERE number = NEW.lookup_number)
      );
    UPDATE g2b_order_plan_list SET visible = ${orderPlanVisibleAttemptSql.replaceAll("NEW.number", "NEW.lookup_number")}
      WHERE number = NEW.lookup_number AND collected_at IS NULL
        AND visible <> ${orderPlanVisibleAttemptSql.replaceAll("NEW.number", "NEW.lookup_number")};
  END;
  CREATE TRIGGER g2b_order_plan_alias_insert AFTER INSERT ON g2b_order_plan_aliases BEGIN
    ${refreshAliasKeys("NEW.lookup_number", "SELECT NEW.plan_number AS number UNION SELECT NEW.lookup_number")}
  END;
  CREATE TRIGGER g2b_order_plan_alias_delete AFTER DELETE ON g2b_order_plan_aliases BEGIN
    ${refreshAliasKeys("OLD.lookup_number", "SELECT OLD.plan_number AS number UNION SELECT OLD.lookup_number")}
  END;
  CREATE TRIGGER g2b_order_plan_alias_update AFTER UPDATE OF plan_number ON g2b_order_plan_aliases BEGIN
    ${refreshAliasKeys("NEW.lookup_number", "SELECT OLD.plan_number AS number UNION SELECT NEW.plan_number")}
  END;

  -- 공고의 요청 번호나 연결 정보가 달라질 때 이전과 새 번호를 한 번씩 갱신한다.
  CREATE TRIGGER g2b_order_plan_notice_insert AFTER INSERT ON notices
  WHEN ${newNotice.lookup} IS NOT NULL BEGIN
    INSERT INTO g2b_order_plan_alias_refresh VALUES (${newNotice.lookup});
  END;
  CREATE TRIGGER g2b_order_plan_notice_delete AFTER DELETE ON notices
  WHEN ${oldNotice.lookup} IS NOT NULL BEGIN
    INSERT INTO g2b_order_plan_alias_refresh VALUES (${oldNotice.lookup});
  END;
  CREATE TRIGGER g2b_order_plan_notice_update AFTER UPDATE OF data, query_data ON notices
  WHEN ${oldNotice.lookup} IS NOT ${newNotice.lookup} OR ${oldNotice.plan} IS NOT ${newNotice.plan}
    OR ${oldNotice.unavailable} IS NOT ${newNotice.unavailable} BEGIN
    INSERT INTO g2b_order_plan_alias_refresh SELECT lookup FROM (
      SELECT ${oldNotice.lookup} AS lookup UNION SELECT ${newNotice.lookup}
    ) WHERE lookup IS NOT NULL;
  END;
`;
