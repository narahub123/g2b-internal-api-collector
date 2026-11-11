import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { decodeHTMLStrict } from "entities";
import type { NoticeListQuery } from "@/entities/notice/model/notice-list-query";
import {
  formatG2bDisplayDate,
  formatG2bDisplayDateTime,
} from "@/shared/lib/g2b/g2b-display-format";
import type { CollectionListRow } from "./collection-attempts";

const pageSize = 15;
const sortColumns = new Map([
  ["posted", "posted"],
  ["submission", "submission"],
  ["deadline", "deadline"],
  ["title", "sortTitle"],
  ["budget", "budget"],
]);

function cleanText(value: unknown) {
  return typeof value === "string"
    ? decodeHTMLStrict(value).normalize("NFC").trim()
    : "";
}

function sortDate(value: unknown) {
  const raw = cleanText(value);
  const formatted = formatG2bDisplayDateTime(raw);
  const date = formatG2bDisplayDate(formatted, "date");
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(date)) return null;
  const day = date.replaceAll("/", "-");
  const time = /[ T](\d{2}:\d{2})(?::(\d{2}))?/.exec(formatted);
  return time ? `${day} ${time[1]}:${time[2] ?? "00"}` : day;
}

function regionsFrom(raw: unknown) {
  const value = cleanText(raw);
  const bracketed = [...value.matchAll(/\[([^\]]+)\]/g)];
  const labels = bracketed.length
    ? bracketed.map((match) => match[1])
    : [value];
  return [
    ...new Set(
      labels
        .flatMap((label) => label.split(/[,;\n]+/))
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ];
}

function noticeFields(raw: unknown) {
  const { payload = {}, title } =
    typeof raw === "string" ? JSON.parse(raw) : {};
  const detail = payload?.dmItemMap ?? {};
  // 같은 시작 코드가 공동수급협정서에도 있으므로 입찰서 제출 종료 코드로 행을 구분한다.
  const schedule = Array.isArray(payload?.dmItemList1)
    ? payload.dmItemList1
    : [];
  const submission =
    schedule.find((item) => item?.endDtNm === "BIDPBANC_SLPRRCPTDDLNDT") ??
    schedule.find(
      (item) => cleanText(item?.subject).replace(/\s+/g, "") === "입찰서제출",
    );
  const budget = detail.alotBgtAmt;
  const amount =
    typeof budget === "number" ||
    (typeof budget === "string" && /^[+-]?\d+(?:\.\d+)?$/.test(budget.trim()))
      ? Number(budget)
      : null;
  const agencies = [detail.dmstUntyGrpNm];
  for (const key of ["dmItemList2", "dmItemItemList"]) {
    if (Array.isArray(payload?.[key])) {
      agencies.push(...payload[key].map((item) => item?.dmstUntyGrpNm));
    }
  }
  // 공고서참조와 누락은 별도 제한 가능성이 있으므로 제한 없음으로 해석하지 않는다.
  const unrestrictedRegion =
    detail.rgnLmtYn === "N" && cleanText(detail.rgnLmtYnNm) === "해당없음";
  return JSON.stringify({
    posted: sortDate(detail.pbancPstgDt),
    submission: sortDate(submission?.startDt),
    deadline: sortDate(submission?.endDt),
    sortTitle: cleanText(title || detail.bidPbancNm) || null,
    agencies: [...new Set(agencies.map(cleanText).filter(Boolean))],
    budget: Number.isFinite(amount) ? amount : null,
    regions: detail.rgnLmtYn === "Y" ? regionsFrom(detail.rgnLmtCn) : [],
    unrestrictedRegion,
  });
}

/**
 * 저장 공고와 수집 이력을 합친 목록에서 입찰공고 조회를 준비한다.
 * @param targets 업무별 저장 대상과 최신 시도를 정의한 저장소 내부 SQL.
 * @throws SQLite에서 함수 등록 또는 조회문 준비가 실패한 경우.
 */
export function openNoticeList(db: DatabaseSync, targets: string) {
  db.function("notice_list_fields", { deterministic: true }, noticeFields);
  db.function("notice_list_regions", { deterministic: true }, (value) =>
    JSON.stringify(regionsFrom(value)),
  );
  db.function("notice_search_text", { deterministic: true }, (value) =>
    cleanText(value).toLowerCase(),
  );
  const regions = db.prepare(`
    SELECT DISTINCT region.value AS label
    FROM notices, json_each(notice_list_regions(json_extract(data, '$.payload.dmItemMap.rgnLmtCn'))) region
    WHERE json_extract(data, '$.payload.dmItemMap.rgnLmtYn') = 'Y'
    ORDER BY label
  `);

  return {
    /**
     * 수집 상태에 관계없이 저장된 공고에서 명시적으로 표시되는 참가 가능 지역을 조회한다.
     * @throws SQLite에서 공고 자료를 읽지 못한 경우.
     */
    regions(): string[] {
      return (regions.all() as { label: string }[]).map(({ label }) => label);
    },

    /**
     * 검색·필터에 일치하는 수집 상태별 건수와 선택된 상태의 현재 페이지를 함께 조회한다.
     * @returns 범위를 벗어난 페이지는 마지막 페이지로 보정하며, 값 없는 행은 정렬 방향에 관계없이 뒤에 둔다.
     * @throws SQLite에서 검색 또는 집계에 실패한 경우.
     */
    page(query: NoticeListQuery) {
      const where: string[] = [];
      const values: SQLInputValue[] = ["notices"];
      const status =
        query.status === "collected"
          ? "collectedAt IS NOT NULL"
          : query.status === "uncollected"
            ? "collectedAt IS NULL"
            : "TRUE";
      // 상세 화면의 하이픈과 목록의 슬래시 모두 같은 공고번호·차수로 검색한다.
      const search =
        query.search.field === "number"
          ? query.search.query.replace(/[\s/-]+/g, "")
          : query.search.query;
      if (search) {
        const match =
          query.search.field === "number"
            ? "instr(notice_search_text(number || revision), notice_search_text(?)) > 0"
            : query.search.field === "agency"
              ? "EXISTS (SELECT 1 FROM json_each(fields, '$.agencies') WHERE instr(notice_search_text(value), notice_search_text(?)) > 0)"
              : "instr(notice_search_text(sortTitle), notice_search_text(?)) > 0";
        where.push(match);
        values.push(search);
      }
      for (const column of ["posted", "submission", "budget"]) {
        const range = query.filters[column];
        if (!range || !("from" in range || "to" in range)) continue;
        const expression =
          column === "budget" ? column : `substr(${column}, 1, 10)`;
        if (range.from !== undefined) {
          where.push(`${expression} >= ?`);
          values.push(range.from);
        }
        if (range.to !== undefined) {
          where.push(`${expression} <= ?`);
          values.push(range.to);
        }
      }
      const selected = query.filters.region;
      if (Array.isArray(selected) && selected.length) {
        where.push(
          "(json_extract(fields, '$.unrestrictedRegion') = 1 OR EXISTS (SELECT 1 FROM json_each(fields, '$.regions') WHERE value IN (SELECT value FROM json_each(?))))",
        );
        values.push(JSON.stringify(selected));
      }
      const [field, direction] = query.sort.split("-");
      const order = sortColumns.get(field) ?? "posted";
      const sql = `${targets},
        projected AS MATERIALIZED (
          SELECT targets.number, targets.revision, targets.opening_revision AS openingRevision,
            saved.collected_at AS collectedAt, saved.title,
            CAST(saved.businessCode AS TEXT) AS businessCode, saved.businessLabel,
            attempt.id, attempt.started_at AS startedAt, attempt.status, attempt.error,
            notice_list_fields(saved.data) AS fields
          FROM targets
          LEFT JOIN saved USING (number, revision, opening_revision)
          LEFT JOIN latest USING (number, revision, opening_revision)
          LEFT JOIN g2b_collection_attempts attempt ON attempt.id = latest.id
        ),
        matches AS MATERIALIZED (
          SELECT *,
            json_extract(fields, '$.posted') AS posted, json_extract(fields, '$.submission') AS submission,
            json_extract(fields, '$.deadline') AS deadline, json_extract(fields, '$.sortTitle') AS sortTitle,
            json_extract(fields, '$.budget') AS budget
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
          ORDER BY sortValue ${direction === "asc" ? "ASC" : "DESC"} NULLS LAST, number, revision
          LIMIT ${pageSize} OFFSET (
            SELECT (max(1, min(?, (selectedCount + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} FROM totals
          )
        )
        SELECT paged.*, totals.total, totals.collected, totals.selectedCount
        FROM totals LEFT JOIN paged ON TRUE
        ORDER BY sortValue ${direction === "asc" ? "ASC" : "DESC"} NULLS LAST, number, revision`;
      const rows = db
        .prepare(sql)
        .all(...values, query.page) as (CollectionListRow & {
        total: number;
        collected: number;
        selectedCount: number;
      })[];
      const { total, collected, selectedCount } = rows[0];
      const totalPages = Math.ceil(selectedCount / pageSize);
      return {
        counts: { total, collected, uncollected: total - collected },
        page: Math.max(1, Math.min(query.page, totalPages)),
        totalPages,
        rows: rows.filter((row) => row.number !== null),
      };
    },
  };
}
