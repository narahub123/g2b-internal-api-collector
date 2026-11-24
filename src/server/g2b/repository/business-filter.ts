import type { G2bDatabase } from "./database";

// 각 업무의 기존 목록과 업무구분 값 형식 및 노출 범위를 연결한다.
const businessLists = {
  notices: { table: "g2b_notice_list", multiple: false, visibleOnly: false },
  "order-plans": { table: "g2b_order_plan_list", multiple: false, visibleOnly: true },
  "contract-requests": { table: "g2b_contract_request_list", multiple: false, visibleOnly: false },
  "prior-specs": { table: "g2b_prior_spec_list", multiple: true, visibleOnly: true },
  "opening-results": { table: "g2b_opening_result_list", multiple: true, visibleOnly: false },
  contracts: { table: "g2b_contract_list", multiple: true, visibleOnly: false },
};

// 업무구분 후보 탐색과 초기 적재에 사용하는 업무 집합이다.
type BusinessSection = keyof typeof businessLists;

// 단일 값은 화면과 같은 파생 필드에서 읽는다.
const businessValue = "json_extract(fields, '$.business')";

// 매핑과 목록 필터에서 함께 사용하는 코드 우선 업무구분 표현식이다.
export const collectionBusinessKeySql = "COALESCE(json_extract(b.value, '$.code'), json_extract(b.value, '$.label'))";

// 선택 업무구분으로 후보를 찾고 복합 키당 값 하나를 유지한다.
export const businessKeySchema = `
  CREATE TABLE g2b_list_business_keys (
    section TEXT NOT NULL, business TEXT NOT NULL, number TEXT NOT NULL,
    revision TEXT NOT NULL, opening_revision TEXT NOT NULL,
    PRIMARY KEY (section, business, number, revision, opening_revision)
  ) WITHOUT ROWID;`;

/**
 * 업무별 후보 인덱스 또는 공통 매핑의 초기 적재와 동기화 SQL을 만든다.
 * @param section 현재 목록 규칙에 따라 설치할 업무.
 * @returns 마이그레이션 트랜잭션에서 실행할 SQL.
 */
export function businessSectionSchema(section: BusinessSection) {
  // 단일 값은 별도 매핑 없이 목록 테이블의 표현식 인덱스로 찾는다.
  const { table, multiple, visibleOnly } = businessLists[section];
  const visible = visibleOnly ? "visible = 1" : "TRUE";
  if (!multiple) {
    // 값과 복합 키를 한 인덱스에서 조회하며 비노출 행은 제외한다.
    return `CREATE INDEX ${table}_business ON ${table}
      (${businessValue}, number, revision, opening_revision)${visibleOnly ? " WHERE visible = 1" : ""};`;
  }

  // 사전규격의 노출 전환도 삽입 및 삭제와 같은 방식으로 반영한다.
  const oldVisible = visibleOnly ? "OLD.visible = 1" : "TRUE";
  const newVisible = visibleOnly ? "NEW.visible = 1" : "TRUE";
  // 이전 값과 복합 키를 함께 지정해 매핑 전체를 훑지 않는다.
  const remove = `DELETE FROM g2b_list_business_keys
    WHERE section = '${section}' AND number = OLD.number AND revision = OLD.revision
      AND opening_revision = OLD.opening_revision AND ${oldVisible}
      AND business IN (SELECT ${collectionBusinessKeySql} FROM json_each(OLD.fields, '$.businesses') b);`;
  // 원본 UPSERT의 충돌 처리와 무관하게 새 목록의 반복 값을 복합 기본 키로 중복 제거한다.
  const insert = `INSERT INTO g2b_list_business_keys
    SELECT '${section}', ${collectionBusinessKeySql}, NEW.number, NEW.revision, NEW.opening_revision
    FROM json_each(NEW.fields, '$.businesses') b
    WHERE ${newVisible} AND ${collectionBusinessKeySql} IS NOT NULL
    ON CONFLICT(section, business, number, revision, opening_revision) DO NOTHING;`;
  // 값이나 키 또는 노출 조건이 실제로 바뀌었을 때만 매핑을 다시 작성한다.
  return `
    INSERT OR IGNORE INTO g2b_list_business_keys
      SELECT '${section}', ${collectionBusinessKeySql}, number, revision, opening_revision
      FROM ${table}, json_each(fields, '$.businesses') b
      WHERE ${visible} AND ${collectionBusinessKeySql} IS NOT NULL;
    CREATE TRIGGER ${table}_filter_business_insert AFTER INSERT ON ${table} BEGIN ${insert} END;
    CREATE TRIGGER ${table}_filter_business_delete AFTER DELETE ON ${table} BEGIN ${remove} END;
    CREATE TRIGGER ${table}_filter_business_update AFTER UPDATE ON ${table}
      WHEN json_extract(OLD.fields, '$.businesses') IS NOT json_extract(NEW.fields, '$.businesses')
        OR OLD.number IS NOT NEW.number OR OLD.revision IS NOT NEW.revision
        OR OLD.opening_revision IS NOT NEW.opening_revision OR (${oldVisible}) IS NOT (${newVisible})
      BEGIN ${remove} ${insert} END;`;
}

/**
 * 적은 업무구분 후보만 같은 읽기 스냅샷의 목록 콜백으로 전달한다.
 * @param db 목록과 후보 인덱스를 읽는 연결.
 * @param section 화면이 조회하는 업무.
 * @param filter 검증된 업무구분 선택값.
 * @param skip 검색·날짜·지역에서 이미 더 적절한 조회 경로가 결정됐는지 여부.
 * @param run 후보 키 JSON 또는 기존 경로를 받아 실제 목록을 조회하는 콜백.
 * @returns 상태별 집계 및 페이지 조회 결과.
 * @throws 후보 탐색 또는 목록 조회가 실패할 경우.
 */
export async function withBusinessKeys<T>(
  db: G2bDatabase,
  section: BusinessSection,
  filter: unknown,
  skip: boolean,
  run: (keys?: string) => Promise<T>,
) {
  // 업무구분을 선택하지 않았거나 기존 우선 경로가 있으면 별도 조회를 하지 않는다.
  if (skip || !Array.isArray(filter) || !filter.length) return run();

  // 후보와 최종 목록은 같은 스냅샷에서 조회해 수집·삭제에 따른 불일치를 피한다.
  return db.transaction(async () => {
    // 전체 목록의 사전 집계 한 행으로 탐색 상한을 계산한다.
    const population = await db.prepare("SELECT total FROM g2b_collection_list_counts WHERE section = ? AND scope = 'all'").get(section);
    const limit = Math.min(256, Math.floor(Number(population?.total ?? 0) * 0.03));
    // 작은 목록은 기존 경로에서 처리한다.
    if (!limit) return run();

    // 매핑 또는 표현식 인덱스로 선택값에 해당하는 목록 키만 찾는다.
    const { table, multiple, visibleOnly } = businessLists[section];
    const selected = "IN (SELECT value FROM json_each(?))";
    const source = multiple
      ? `g2b_list_business_keys WHERE section = '${section}' AND business ${selected}`
      : `${table} INDEXED BY ${table}_business WHERE ${businessValue} ${selected}${visibleOnly ? " AND visible = 1" : ""}`;
    // 중복 제거 전 상한으로 매핑 읽기를 제한하고 포화되면 기존 쿼리로 돌아간다.
    const matches = await db.prepare(`SELECT number, revision, opening_revision FROM ${source} LIMIT ?`).all(JSON.stringify(filter), limit);
    if (matches.length >= limit) return run();

    // 값이 여러 개 겹친 후보는 최종 페이지 CTE에서 복합 키 단위로 합친다.
    return run(JSON.stringify(matches.map(({ number, revision, opening_revision }) => [number, revision, opening_revision])));
  }, false);
}
