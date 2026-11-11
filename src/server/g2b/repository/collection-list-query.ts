import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { decodeHTMLStrict } from "entities";
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
