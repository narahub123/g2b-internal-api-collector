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
 * @returns 기존 데이터 초기화와 삽입·삭제·변경 트리거를 설치하는 SQL.
 */
export function datePageSectionSchema(section: DatePageSection) {
  // 업무의 목록 테이블과 노출 조건을 조회와 동일하게 사용한다.
  const { table, date, visible, prefixLength } = datePages[section];
  // 변경 전후의 구간 키와 노출 여부를 트리거 행에서 평가한다.
  const oldBucket = dateBucket(`OLD.${date}`, prefixLength);
  const newBucket = dateBucket(`NEW.${date}`, prefixLength);
  const oldVisible = visible === "TRUE" ? visible : `OLD.${visible}`;
  const newVisible = visible === "TRUE" ? visible : `NEW.${visible}`;
  // 기존 구간에서 한 건을 빼고 마지막 행이 사라졌으면 빈 구간을 제거한다.
  const remove = `
    UPDATE g2b_list_date_buckets SET count = count - 1
      WHERE section = '${section}' AND bucket = ${oldBucket} AND ${oldVisible};
    DELETE FROM g2b_list_date_buckets
      WHERE section = '${section}' AND bucket = ${oldBucket} AND count = 0;`;
  // 목록에 노출되는 새 행을 해당 구간에 한 건 추가한다.
  const add = `
    INSERT INTO g2b_list_date_buckets SELECT '${section}', ${newBucket}, 1 WHERE ${newVisible}
    ON CONFLICT(section, bucket) DO UPDATE SET count = count + 1;`;
  // 초기 집계를 적재한 뒤 구간이나 노출 조건이 바뀌는 행만 다시 집계한다.
  return `
    INSERT INTO g2b_list_date_buckets
      SELECT '${section}', ${dateBucket(date, prefixLength)}, COUNT(*) FROM ${table}
      WHERE ${visible} GROUP BY ${dateBucket(date, prefixLength)};
    CREATE TRIGGER ${table}_date_bucket_insert AFTER INSERT ON ${table}
      WHEN ${newVisible} BEGIN ${add} END;
    CREATE TRIGGER ${table}_date_bucket_delete AFTER DELETE ON ${table}
      WHEN ${oldVisible} BEGIN ${remove} END;
    CREATE TRIGGER ${table}_date_bucket_update AFTER UPDATE ON ${table}
      WHEN ((${oldVisible}) OR (${newVisible}))
        AND ((${oldVisible}) IS NOT (${newVisible}) OR ${oldBucket} IS NOT ${newBucket})
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
