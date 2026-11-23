import type { G2bDatabase, SQLInputValue } from "./database";
import { decodeHTMLStrict } from "entities";
import type { CollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import { formatG2bDisplayDate, formatG2bDisplayDateTime } from "@/shared/lib/g2b/g2b-display-format";
import type { CollectionListRow, CollectionSection } from "./collection-attempts";
import { COLLECTION_LIST_PAGE_SIZE as pageSize } from "@/shared/config/collection-list";

/** 검색과 정렬에서 HTML 엔티티를 해제하고 한글을 NFC로 통일한다. */
export function cleanText(value: unknown) {
  return typeof value === "string"
    ? decodeHTMLStrict(value).normalize("NFC").trim()
    : "";
}

/** 원본과 검색어에 같은 대소문자 및 유니코드 정규화 규칙을 적용한다. */
export function searchText(value: unknown) {
  return cleanText(value).toLowerCase();
}

/** 저장된 업무 일시를 날짜 범위 검색과 정렬에 사용하는 문자열로 변환한다. */
export function sortDate(value: unknown) {
  const raw = cleanText(value);
  const formatted = formatG2bDisplayDateTime(raw);
  const date = formatG2bDisplayDate(formatted, "date");
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(date)) return null;
  const day = date.replaceAll("/", "-");
  const time = /[ T](\d{2}:\d{2})(?::(\d{2}))?/.exec(formatted);
  return time ? `${day} ${time[1]}:${time[2] ?? "00"}` : day;
}

type CollectionPageOptions = {
  section: CollectionSection;
  projection: string;
  columns: string;
  where: string[];
  values: SQLInputValue[];
  order: string;
  ascending: boolean;
  status: "total" | "collected" | "uncollected";
  page: number;
};

/**
 * 검색·필터를 적용한 상태별 집계와 선택된 상태의 페이지를 한 번의 SQLite 조회로 반환한다.
 * @param options projection·columns·where·order는 저장소가 정의한 SQL이며 사용자 값은 values에 바인딩한다.
 * @throws Turso에서 조회문 준비나 실행이 실패한 경우.
 */
export async function queryCollectionPage(db: G2bDatabase, targets: string, options: CollectionPageOptions) {
  const { section, projection, columns, where, values, order, ascending, page } = options;
  const status = options.status === "collected" ? "collectedAt IS NOT NULL"
    : options.status === "uncollected" ? "collectedAt IS NULL" : "TRUE";
  const sql = `${targets},
    projected AS MATERIALIZED (
      SELECT targets.number, targets.revision, targets.opening_revision AS openingRevision,
        saved.collected_at AS collectedAt, saved.title,
        CAST(saved.businessCode AS TEXT) AS businessCode, saved.businessLabel,
        attempt.id, attempt.started_at AS startedAt, attempt.status, attempt.error,
        ${projection}
      FROM targets
      LEFT JOIN saved USING (number, revision, opening_revision)
      LEFT JOIN latest USING (number, revision, opening_revision)
      LEFT JOIN g2b_collection_attempts attempt ON attempt.id = latest.id
    ),
    matches AS MATERIALIZED (
      SELECT *, ${columns}
      FROM projected
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ),
    totals AS (
      SELECT COUNT(*) AS total, COUNT(collectedAt) AS collected,
        COUNT(*) FILTER (WHERE ${status}) AS selectedCount
      FROM matches
    ),
    paged AS (
      SELECT number, revision, openingRevision, collectedAt, title, businessCode, businessLabel,
        id, startedAt, status, error, ${order} AS sortValue
      FROM matches
      WHERE ${status}
      ORDER BY sortValue ${ascending ? "ASC" : "DESC"} NULLS LAST, number, revision
      LIMIT ${pageSize} OFFSET (
        SELECT (max(1, min(?, (selectedCount + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} FROM totals
      )
    )
    SELECT paged.*, totals.total, totals.collected, totals.selectedCount, diagnostic_attempt.diagnostics
    FROM totals LEFT JOIN paged ON TRUE
    LEFT JOIN g2b_collection_attempts diagnostic_attempt ON diagnostic_attempt.id = paged.id
    ORDER BY sortValue ${ascending ? "ASC" : "DESC"} NULLS LAST, number, revision`;
  const rows = await db
    .prepare(sql)
    .all(section, ...values, page) as (CollectionListRow & {
    total: number;
    collected: number;
    selectedCount: number;
  })[];
  const { total, collected, selectedCount } = rows[0];
  const totalPages = Math.ceil(selectedCount / pageSize);
  return {
    counts: { total, collected, uncollected: total - collected },
    page: Math.max(1, Math.min(page, totalPages)),
    totalPages,
    rows: rows.filter((row) => row.number !== null),
  };
}

// 공통 업무구분의 값은 코드가 있을 때 코드를 우선 사용한다.
export const collectionBusinessKeySql = "COALESCE(json_extract(b.value, '$.code'), json_extract(b.value, '$.label'))";

/**
 * 업무가 전달한 조회 필드로 검색·필터와 페이지 조회를 연결한다.
 * @param projection 저장소가 정의한 SQL 표현식. 정규화된 날짜·기관·업무구분 JSON을 반환한다.
 * @param extraCondition 업무 전용 범위 조건을 조합하는 함수. range가 경계값을 바인딩한다.
 * @throws SQLite 함수 등록이나 조회문 준비가 실패한 경우.
 */
export function openCollectionList(
  db: G2bDatabase,
  section: CollectionSection,
  targets: string,
  projection: string,
  extraCondition?: (range: (id: string, expression: string) => string) => string,
) {
  const businessOptions = db.prepare(`${targets}
    SELECT DISTINCT ${collectionBusinessKeySql} AS value, json_extract(b.value, '$.label') AS label
    FROM saved, json_each(${projection}, '$.businesses') b
    ORDER BY label
  `);

  return {
    /**
     * 저장된 업무 자료에 있는 업무구분을 선택지로 조회한다.
     * @throws Turso에서 업무구분을 읽지 못한 경우.
     */
    async businesses() {
      return (await businessOptions.all(section) as { value: string; label: string }[])
        .map(({ value, label }) => ({ value, label }));
    },

    /**
     * 검색과 필터에 일치하는 건수를 집계하고 선택 상태의 페이지를 반환한다.
     * @throws Turso에서 조회문 준비나 실행이 실패한 경우.
     */
    page(query: CollectionListQuery) {
      // 업무별 조회 경로에서 동일한 검색과 필터 규칙을 사용한다.
      const criteria = collectionListCriteria(query, extraCondition);
      return queryCollectionPage(db, targets, {
        section,
        projection: `${projection} AS fields, NULLIF(saved.searchTitle, '') AS sortTitle`,
        columns: "json_extract(fields, '$.date') AS sortDate",
        ...criteria,
        status: query.status,
        page: query.page,
      });
    },
  };
}/**
 * 기존 목록의 검색·업무구분·날짜 조건을 SQL과 바인딩으로 변환한다.
 * @param query URL에서 검증한 목록 조건.
 * @param extraCondition 업무 전용 범위 조건을 같은 바인딩 순서에 추가하는 함수.
 * @returns 목록 SQL에서 사용할 조건, 인자 및 정렬.
 */
export function collectionListCriteria(
  query: CollectionListQuery,
  extraCondition?: (range: (id: string, expression: string) => string) => string,
) {
  // 활성 검색과 필터를 적용할 SQL 조건을 모은다.
  const where: string[] = [];
  // 각 조건이 사용하는 값을 SQL 자리표시자 순서대로 모은다.
  const values: SQLInputValue[] = [];
  // 검색 대상을 구분하고 입력한 검색어가 있을 때만 조건을 추가한다.
  const { field, query: keyword } = query.search;
  if (keyword) {
    // 번호 검색은 구분자를 제외한 번호·차수와 원래 형식의 접수번호를 함께 비교한다.
    if (field === "number") {
      where.push("(instr(lower(number || revision), ?) > 0 OR instr(json_extract(fields, '$.receipt'), ?) > 0)");
      values.push(searchText(keyword.replace(/[\s/-]+/g, "") || keyword), searchText(keyword));
    // 기관 검색은 정규화한 기관 배열 중 일치하는 항목을 찾는다.
    } else if (field === "agency") {
      where.push("EXISTS (SELECT 1 FROM json_each(fields, '$.agencies') WHERE instr(value, ?) > 0)");
      values.push(searchText(keyword));
    // 기본 검색은 정렬에도 쓰는 정규화 제목을 비교한다.
    } else {
      where.push("instr(sortTitle, ?) > 0");
      values.push(searchText(keyword));
    }
  }

  // 업무구분을 선택한 경우에만 해당 값으로 목록 범위를 좁힌다.
  const selected = query.filters.business;
  if (Array.isArray(selected) && selected.length) {
    where.push(`EXISTS (SELECT 1 FROM json_each(fields, '$.businesses') b WHERE ${collectionBusinessKeySql} IN (SELECT value FROM json_each(?)))`);
    values.push(JSON.stringify(selected));
  }

  /**
   * 화면에서 실제로 지정한 날짜 경계만 바인딩 순서에 추가한다.
   * @param id 검증된 필터의 식별자.
   * @param expression 저장소가 제공하는 비교 대상 SQL 표현식.
   * @returns 활성 경계의 조건 또는 비활성 상태를 나타내는 빈 문자열.
   */
  function rangeCondition(id: string, expression: string) {
    // 경계값이 없는 필터는 비교식에 포함하지 않는다.
    const range = query.filters[id];
    if (!range || !("from" in range || "to" in range)) return "";
    // 시작일과 종료일이 각각 있는 경우에만 해당 경계를 포함한다.
    const conditions = [];
    if (range.from !== undefined) {
      conditions.push(`${expression} >= ?`);
      values.push(range.from);
    }
    if (range.to !== undefined) {
      conditions.push(`${expression} <= ?`);
      values.push(range.to);
    }
    // 두 경계가 있으면 모두 만족하는 범위로 제한한다.
    return conditions.join(" AND ");
  }

  // 계약일 등 업무 날짜의 날짜 부분을 비교하고 업무가 제공한 추가 범위 조건도 합친다.
  const date = rangeCondition("date", "substr(sortDate, 1, 10)");
  if (date) where.push(date);
  const extra = extraCondition?.(rangeCondition);
  if (extra) where.push(extra);

  // 기존 정렬 키와 방향을 조건과 함께 반환한다.
  const [sort, direction] = query.sort.split("-");
  return { where, values, order: sort === "title" ? "sortTitle" : "sortDate", ascending: direction === "asc" };
}
