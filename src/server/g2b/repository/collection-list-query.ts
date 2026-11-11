import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { decodeHTMLStrict } from "entities";
import type { CollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import { formatG2bDisplayDate, formatG2bDisplayDateTime } from "@/shared/lib/g2b/g2b-display-format";
import type { CollectionListRow, CollectionSection } from "./collection-attempts";

const pageSize = 15;

/** 검색과 정렬에서 HTML 엔티티를 해제하고 한글을 NFC로 통일한다. */
export function cleanText(value: unknown) {
  return typeof value === "string"
    ? decodeHTMLStrict(value).normalize("NFC").trim()
    : "";
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
 * @throws SQLite에서 조회문 준비나 실행이 실패한 경우.
 */
export function queryCollectionPage(db: DatabaseSync, targets: string, options: CollectionPageOptions) {
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
    SELECT paged.*, totals.total, totals.collected, totals.selectedCount
    FROM totals LEFT JOIN paged ON TRUE
    ORDER BY sortValue ${ascending ? "ASC" : "DESC"} NULLS LAST, number, revision`;
  const rows = db
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

const businessKey = "COALESCE(json_extract(b.value, '$.code'), json_extract(b.value, '$.label'))";

/**
 * 업무가 전달한 조회 필드로 검색·필터와 페이지 조회를 연결한다.
 * @param projection 저장소가 정의한 SQL 표현식. 정규화된 날짜·기관·업무구분 JSON을 반환한다.
 * @param extraCondition 업무 전용 범위 조건을 조합하는 함수. range가 경계값을 바인딩한다.
 * @throws SQLite 함수 등록이나 조회문 준비가 실패한 경우.
 */
export function openCollectionList(
  db: DatabaseSync,
  section: CollectionSection,
  targets: string,
  projection: string,
  extraCondition?: (range: (id: string, expression: string) => string) => string,
) {
  const businessOptions = db.prepare(`${targets}
    SELECT DISTINCT ${businessKey} AS value, json_extract(b.value, '$.label') AS label
    FROM saved, json_each(${projection}, '$.businesses') b
    ORDER BY label
  `);

  return {
    /**
     * 저장된 업무 자료에 있는 업무구분을 선택지로 조회한다.
     * @throws SQLite에서 업무구분을 읽지 못한 경우.
     */
    businesses() {
      return (businessOptions.all(section) as { value: string; label: string }[])
        .map(({ value, label }) => ({ value, label }));
    },

    /**
     * 검색과 필터에 일치하는 건수를 집계하고 선택 상태의 페이지를 반환한다.
     * @throws SQLite에서 조회문 준비나 실행이 실패한 경우.
     */
    page(query: CollectionListQuery) {
      const where: string[] = [];
      const values: SQLInputValue[] = [];
      const { field, query: keyword } = query.search;
      if (keyword) {
        if (field === "number") {
          where.push("(instr(collection_search_text(number || revision), collection_search_text(?)) > 0 OR instr(collection_search_text(json_extract(fields, '$.receipt')), collection_search_text(?)) > 0)");
          values.push(keyword.replace(/[\s/-]+/g, "") || keyword, keyword);
        } else if (field === "agency") {
          where.push("EXISTS (SELECT 1 FROM json_each(fields, '$.agencies') WHERE instr(collection_search_text(value), collection_search_text(?)) > 0)");
          values.push(keyword);
        } else {
          where.push("instr(sortTitle, collection_search_text(?)) > 0");
          values.push(keyword);
        }
      }

      const selected = query.filters.business;
      if (Array.isArray(selected) && selected.length) {
        where.push(`EXISTS (SELECT 1 FROM json_each(fields, '$.businesses') b WHERE ${businessKey} IN (SELECT value FROM json_each(?)))`);
        values.push(JSON.stringify(selected));
      }

      function rangeCondition(id: string, expression: string) {
        const range = query.filters[id];
        if (!range || !("from" in range || "to" in range)) return "";
        const conditions = [];
        if (range.from !== undefined) {
          conditions.push(`${expression} >= ?`);
          values.push(range.from);
        }
        if (range.to !== undefined) {
          conditions.push(`${expression} <= ?`);
          values.push(range.to);
        }
        return conditions.join(" AND ");
      }

      const date = rangeCondition("date", "substr(sortDate, 1, 10)");
      if (date) where.push(date);
      const extra = extraCondition?.(rangeCondition);
      if (extra) where.push(extra);

      const [sort, direction] = query.sort.split("-");
      return queryCollectionPage(db, targets, {
        section,
        projection: `${projection} AS fields, NULLIF(collection_search_text(saved.title), '') AS sortTitle`,
        columns: "json_extract(fields, '$.date') AS sortDate",
        where,
        values,
        order: sort === "title" ? "sortTitle" : "sortDate",
        ascending: direction === "asc",
        status: query.status,
        page: query.page,
      });
    },
  };
}
