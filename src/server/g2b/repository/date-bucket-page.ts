import { COLLECTION_LIST_PAGE_SIZE as pageSize } from "@/shared/config/collection-list";

// 날짜 오름차순 인덱스와 구간 집계가 공유해야 하는 목록 범위를 지정한다.
const datePages = {
  // 입찰공고 관리자 전체 목록의 게시 일시를 사용한다.
  notices: { table: "g2b_notice_list", date: "posted", index: "g2b_notice_list_posted_asc", visible: "TRUE", prefixLength: 13 },
  // 발주계획과 사전규격은 비노출 키를 건수와 날짜 탐색에서 함께 제외한다.
  "order-plans": { table: "g2b_order_plan_list", date: "released", index: "g2b_order_plan_list_released_asc", visible: "visible = 1", prefixLength: 10 },
  "prior-specs": { table: "g2b_prior_spec_list", date: "sortDate", index: "g2b_prior_spec_list_date_asc", visible: "visible = 1", prefixLength: 10 },
  // 개찰결과·계약요청·계약현황은 기본 날짜 열을 일 단위로 묶어 구간 수를 줄인다.
  "opening-results": { table: "g2b_opening_result_list", date: "sortDate", index: "g2b_opening_result_list_date_asc", visible: "TRUE", prefixLength: 10 },
  "contract-requests": { table: "g2b_contract_request_list", date: "written", index: "g2b_contract_request_list_written_asc", visible: "TRUE", prefixLength: 10 },
  contracts: { table: "g2b_contract_list", date: "sortDate", index: "g2b_contract_list_date_asc", visible: "TRUE", prefixLength: 10 },
};

// 구간 집계가 설치되고 조회할 수 있는 업무를 제한한다.
type DatePageSection = keyof typeof datePages;

// 얕은 요청에서는 구간 계산 비용을 피하고 기존 페이지 인덱스를 사용한다.
export const firstDateSeekPage = 65;

// 모든 업무의 구간 건수는 업무와 문자열 순서로 조회하며 빈 일시는 별도 키에 모은다.
export const datePageSchema = `
  CREATE TABLE g2b_list_date_buckets (
    section TEXT NOT NULL, bucket TEXT NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY (section, bucket)
  ) WITHOUT ROWID;
`;

/**
 * 날짜를 기존 정렬 순서대로 묶고 빈 일시는 날짜가 있는 구간과 구별한다.
 * @param column 목록 또는 트리거에서 읽는 날짜 열의 고정 SQL 표현식.
 * @param prefixLength 해당 업무에서 날짜를 구간으로 묶는 접두사의 길이.
 * @returns 날짜가 없으면 0, 있으면 1과 시각 앞부분을 이어 붙이는 SQL.
 */
function dateBucket(column: string, prefixLength: number) {
  // 같은 접두사를 가진 날짜들은 기존 인덱스에서도 연속된 구간을 이룬다.
  return `COALESCE('1' || substr(${column}, 1, ${prefixLength}), '0')`;
}

/**
 * 목록을 한 번 읽어 구간 집계를 초기화하고 이후 변경을 같은 트랜잭션에 반영한다.
 * @param section 마이그레이션에 구간 집계를 설치할 업무.
 * @param withCollected 마이그레이션 39 이후에만 수집 건수를 함께 유지한다.
 * @returns 기존 데이터 초기화와 삽입·삭제·변경 트리거를 설치하는 SQL.
 */
export function datePageSectionSchema(section: DatePageSection, withCollected = false) {
  // 업무의 목록 테이블과 노출 조건을 조회와 동일하게 사용한다.
  const { table, date, visible, prefixLength } = datePages[section];
  // 변경 전후의 구간 키와 노출 여부를 트리거 행에서 평가한다.
  const oldBucket = dateBucket(`OLD.${date}`, prefixLength);
  const newBucket = dateBucket(`NEW.${date}`, prefixLength);
  const oldVisible = visible === "TRUE" ? visible : `OLD.${visible}`;
  const newVisible = visible === "TRUE" ? visible : `NEW.${visible}`;
  // 버전 39에서는 구간의 전체 건수와 수집 건수가 같은 원본 상태를 반영한다.
  const collectedRemove = withCollected ? ", collected = collected - (OLD.collected_at IS NOT NULL)" : "";
  const collectedValue = withCollected ? ", (NEW.collected_at IS NOT NULL)" : "";
  const collectedAdd = withCollected ? ", collected = collected + excluded.collected" : "";
  const collectedBackfill = withCollected ? ", COUNT(collected_at)" : "";
  const collectedChange = withCollected ? " OR (OLD.collected_at IS NULL) IS NOT (NEW.collected_at IS NULL)" : "";
  // 기존 구간에서 한 건을 빼고 마지막 행이 사라졌으면 빈 구간을 제거한다.
  const remove = `
    UPDATE g2b_list_date_buckets SET count = count - 1${collectedRemove}
      WHERE section = '${section}' AND bucket = ${oldBucket} AND ${oldVisible};
    DELETE FROM g2b_list_date_buckets
      WHERE section = '${section}' AND bucket = ${oldBucket} AND count = 0;`;
  // 목록에 노출되는 새 행을 해당 구간에 한 건 추가한다.
  const add = `
    INSERT INTO g2b_list_date_buckets SELECT '${section}', ${newBucket}, 1${collectedValue} WHERE ${newVisible}
    ON CONFLICT(section, bucket) DO UPDATE SET count = count + 1${collectedAdd};`;
  // 초기 집계를 적재한 뒤 구간이나 노출 조건이 바뀌는 행만 다시 집계한다.
  return `
    INSERT INTO g2b_list_date_buckets
      SELECT '${section}', ${dateBucket(date, prefixLength)}, COUNT(*)${collectedBackfill} FROM ${table}
      WHERE ${visible} GROUP BY ${dateBucket(date, prefixLength)};
    CREATE TRIGGER ${table}_date_bucket_insert AFTER INSERT ON ${table}
      WHEN ${newVisible} BEGIN ${add} END;
    CREATE TRIGGER ${table}_date_bucket_delete AFTER DELETE ON ${table}
      WHEN ${oldVisible} BEGIN ${remove} END;
    CREATE TRIGGER ${table}_date_bucket_update AFTER UPDATE ON ${table}
      WHEN ((${oldVisible}) OR (${newVisible}))
        AND ((${oldVisible}) IS NOT (${newVisible}) OR ${oldBucket} IS NOT ${newBucket}${collectedChange})
      BEGIN ${remove} ${add} END;`;
}

/**
 * 날짜 인덱스의 앞뒤 탐색과 구간 시작점으로 보정된 페이지의 키만 읽는다.
 * @param section 날짜 오름차순 전체 목록을 읽을 업무.
 * @returns 기존 totals의 total과 페이지 번호 바인딩 하나를 사용하는 paged CTE SQL.
 */
export function dateBucketPageSql(section: DatePageSection) {
  // 목록의 기존 복합 키와 날짜 인덱스를 페이지 탐색에도 재사용한다.
  const { table, date, index, visible } = datePages[section];
  // 날짜가 없는 행까지 포함한 정방향 순서와 그 역순을 준비한다.
  const keys = "number, revision, opening_revision";
  const forward = `(${date} IS NULL) ASC, ${date} ASC, ${keys}`;
  const backward = `(${date} IS NULL) DESC, ${date} DESC, number DESC, revision DESC, opening_revision DESC`;
  // 날짜가 고정적으로 존재하는 범위에서는 NULL 정렬식을 빼고 인덱스에서 바로 읽는다.
  const seekOrder = `${date} ASC, ${keys}`;
  const source = `SELECT ${keys}, collected_at, latest_id, ${date} AS sortValue
    FROM ${table} INDEXED BY ${index} WHERE ${visible}`;
  // 요청 번호를 보정하고, 끝에 있는 불완전한 페이지와 빈 목록의 폭을 정한다.
  // 빈 날짜의 경계를 넘는 경우에도 기존 인덱스 순서를 보존하도록 정방향 전체 탐색이 가능하다.
  return `bounds AS MATERIALIZED (
      SELECT (max(1, min(?, (total + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} AS front,
        total,
        COALESCE((SELECT count FROM g2b_list_date_buckets WHERE section = '${section}' AND bucket = '0'), 0) AS blanks
      FROM totals
    ),
    page_route AS MATERIALIZED (
      SELECT front, max(0, min(${pageSize}, total - front)) AS width,
        max(0, total - front - ${pageSize}) AS back, total - blanks AS dated
      FROM bounds
    ),
    page_anchor AS MATERIALIZED (
      SELECT substr(bucket, 2) AS start, finish - count AS previous
      FROM (
        SELECT bucket, count, sum(count) OVER (ORDER BY bucket ROWS UNBOUNDED PRECEDING) AS finish
        FROM g2b_list_date_buckets
        WHERE section = '${section}' AND bucket > '0'
          AND (SELECT front <= back AND front + width <= dated AND width > 0 FROM page_route)
      )
      WHERE finish > (SELECT front FROM page_route)
      LIMIT 1
    ),
    seek_page AS MATERIALIZED (
      ${source} AND (${date} IS NULL) = 0 AND ${date} >= (SELECT start FROM page_anchor)
      ORDER BY ${seekOrder}
      LIMIT (SELECT CASE WHEN EXISTS (SELECT 1 FROM page_anchor) THEN width ELSE 0 END FROM page_route)
      OFFSET (SELECT COALESCE(front - (SELECT previous FROM page_anchor), 0) FROM page_route)
    ),
    forward_page AS MATERIALIZED (
      ${source} ORDER BY ${forward}
      LIMIT (SELECT CASE WHEN front <= back AND NOT EXISTS (SELECT 1 FROM page_anchor) THEN width ELSE 0 END FROM page_route)
      OFFSET (SELECT front FROM page_route)
    ),
    backward_page AS MATERIALIZED (
      ${source} ORDER BY ${backward}
      LIMIT (SELECT CASE WHEN front > back THEN width ELSE 0 END FROM page_route)
      OFFSET (SELECT back FROM page_route)
    ),
    paged AS MATERIALIZED (
      SELECT * FROM seek_page UNION ALL SELECT * FROM forward_page UNION ALL SELECT * FROM backward_page
    )`;
}

/**
 * 기존 구간을 수집 건수와 함께 다시 채우고 해당 업무의 트리거를 교체한다.
 * @param section 목록 범위와 날짜 열이 설정된 업무.
 * @returns 마이그레이션 트랜잭션에서 실행할 갱신 SQL.
 */
export function upgradeDatePageSection(section: DatePageSection) {
  // 구간 건수를 만드는 기존 목록과 같은 이름의 동기화 트리거를 교체한다.
  const { table } = datePages[section];
  // 전체 재적재는 한 번만 수행하며 기존 읽기 경로가 쓰는 전체 건수도 함께 계산한다.
  return `
    DROP TRIGGER ${table}_date_bucket_insert;
    DROP TRIGGER ${table}_date_bucket_delete;
    DROP TRIGGER ${table}_date_bucket_update;
    DELETE FROM g2b_list_date_buckets WHERE section = '${section}';
    ${datePageSectionSchema(section, true)}`;
}

/**
 * 관리자 전체 목록의 날짜 단독 정렬에서 달력일 범위에 속한 구간을 탐색한다.
 * @param section 기존 날짜 구간과 인덱스를 제공하는 업무.
 * @param where 기존 SQL 조건과 순서.
 * @param values 기존 날짜 범위 바인딩. 종료일은 이미 배타적 상한으로 바뀌었다.
 * @param page 사용자가 요청한 페이지 번호.
 * @returns 구간 집계와 페이지 후보 CTE 및 바인딩. 다른 조건이나 단일 날짜 구간이면 undefined.
 */
export function rangedDatePage(
  section: DatePageSection,
  where: string[],
  values: readonly unknown[],
  page: number,
) {
  // 목록이 쓰는 날짜 열과 NULL 정렬 표현식을 인덱스와 공유한다.
  const { table, date, index, visible } = datePages[section];
  // 달력 날짜 이외의 조건은 날짜 집계가 설명할 수 없으므로 기존 조회를 사용한다.
  if (page < firstDateSeekPage || !where.length || !where.every(clause => clause === `${date} >= ?` || clause === `${date} < ?`)) return;
  // 기존 바인딩에서 두 경계를 읽어 URL과 같은 배타적 종료일을 보존한다.
  const lower = values[where.indexOf(`${date} >= ?`)];
  const upper = values[where.indexOf(`${date} < ?`)];
  // 저장 경계가 달력일일 때는 시간 단위 구간도 경계를 넘지 않는다.
  if ([lower, upper].some(value => value !== undefined && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)))) return;
  // 같은 날짜만 조회하는 요청은 기존 날짜 탐색을 사용한다.
  if (typeof lower === "string" && typeof upper === "string" && Date.parse(upper) - Date.parse(lower) <= 86_400_000) return;

  // 시작·종료가 없는 경우 구간의 해당 비교식을 생략해 기본 키 범위를 유지한다.
  const bucketBounds = [typeof lower === "string" ? "bucket >= '1' || ?" : "", typeof upper === "string" ? "bucket < '1' || ?" : ""].filter(Boolean);
  // 필요한 필드만 골라 최종 상세 조인은 기존 응답 경로에 남긴다.
  const keys = "number, revision, opening_revision";
  // 요청 범위에서 누적 건수를 계산해 페이지 시작 구간의 앞 행 수를 찾는다.
  // 보정된 페이지가 얕으면 시작점을 사용하지 않고 기존 범위 안에서 OFFSET을 적용한다.
  const sql = `range_buckets AS MATERIALIZED (
      SELECT bucket, count, collected FROM g2b_list_date_buckets
      WHERE section = '${section}' AND bucket > '0'${bucketBounds.map(bound => " AND " + bound).join("")}
    ),
    totals AS MATERIALIZED (
      SELECT COALESCE(sum(count), 0) AS total, COALESCE(sum(collected), 0) AS collected FROM range_buckets
    ),
    range_offset AS MATERIALIZED (
      SELECT (max(1, min(?, (total + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} AS front FROM totals
    ),
    range_anchor AS MATERIALIZED (
      SELECT substr(bucket, 2) AS start, finish - count AS previous
      FROM (
        SELECT bucket, count, sum(count) OVER (ORDER BY bucket ROWS UNBOUNDED PRECEDING) AS finish
        FROM range_buckets WHERE (SELECT front >= ${(firstDateSeekPage - 1) * pageSize} FROM range_offset)
      )
      WHERE finish > (SELECT front FROM range_offset)
      LIMIT 1
    ),
    paged AS MATERIALIZED (
      SELECT ${keys}, collected_at, latest_id, ${date} AS sortValue
      FROM ${table} INDEXED BY ${index} WHERE ${visible} AND (${date} IS NULL) = 0
        AND ${date} >= COALESCE((SELECT start FROM range_anchor), ?)${typeof upper === "string" ? ` AND ${date} < ?` : ""}
      ORDER BY ${date} ASC, ${keys}
      LIMIT ${pageSize} OFFSET (SELECT front - COALESCE((SELECT previous FROM range_anchor), 0) FROM range_offset)
    )`;
  // 최초 날짜 범위, 요청 페이지, 실제 페이지 경계를 SQL에 등장한 순서로 넘긴다.
  const args = [lower, upper].filter((value): value is string => typeof value === "string");
  return { sql, args: [...args, page, typeof lower === "string" ? lower : "", ...typeof upper === "string" ? [upper] : []] };
}
