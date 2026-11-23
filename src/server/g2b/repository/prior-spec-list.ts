import type { CollectionListRow } from "./collection-attempts";
import type { CollectionListQuery } from "@/shared/model/g2b/collection-list-query";
import { COLLECTION_LIST_PAGE_SIZE as pageSize } from "@/shared/config/collection-list";
import type { G2bDatabase } from "./database";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { cleanText, collectionListCriteria, sortDate } from "./collection-list-query";

function asAmount(raw: unknown) {
  const value = typeof raw === "number" ||
    (typeof raw === "string" && /^[+-]?\d+(?:\.\d+)?$/.test(raw.trim())) ? Number(raw) : null;
  return Number.isFinite(value) ? value : null;
}

/** 수집 원본에서 목록 검색과 정렬에 필요한 파생값을 계산한다. */
export function priorSpecFields(raw: unknown, rawCode: unknown, rawLabel: unknown) {
  const data = typeof raw === "string" ? JSON.parse(raw) : null;
  const business = resolveG2bBusiness(rawCode, rawLabel);
  const businesses = business ? [business] : [];
  const detail = data?.payload?.dlBfSpecM;
  // 외자 상세의 달러 금액과 원화 금액을 같은 범위에서 비교하지 않는다.
  const foreign = business?.code === "02" || business?.code === "04";
  return JSON.stringify({
    date: sortDate(detail?.specRlsDt),
    agencies: [cleanText(detail?.dmstUntyGrpNm)].filter(Boolean),
    receipt: cleanText(detail?.bfSpecRegNo),
    businesses,
    budget: !foreign ? asAmount(detail?.alotBgtPrspAmt) : null,
    budgetUsd: foreign ? asAmount(detail?.alotBgtPrspAmt) : null,
  });
}

/**
 * 원화와 외자 예산을 각각 해당 통화의 필드와 비교한다.
 * @param range 활성 범위의 경계값을 바인딩하는 공통 함수.
 * @returns 각 통화의 범위 중 하나가 일치하는 조건 또는 조건이 없으면 빈 문자열.
 */
function budgetConditions(range: (id: string, expression: string) => string) {
  // 두 통화의 범위는 해당 통화 행에만 값이 있으므로 하나라도 충족하면 표시한다.
  const conditions = [
    range("budget", "json_extract(fields, '$.budget')"),
    range("budgetUsd", "json_extract(fields, '$.budgetUsd')"),
  ].filter(Boolean);
  return conditions.length ? `(${conditions.map((value) => `(${value})`).join(" OR ")})` : "";
}

/**
 * 사전규격 목록과 업무구분 선택지의 전용 조회를 구성한다.
 * @param db 사전규격 목록, 선택지 집계와 원본을 함께 읽는 DB 연결.
 * @returns 관리자와 사용자가 공유하는 목록 및 선택지 조회 함수.
 */
export function openPriorSpecList(db: G2bDatabase) {
  // 원본 전체를 읽지 않고 현재 사용 중인 선택지의 값과 라벨을 반환한다.
  const options = db.prepare(`SELECT json_extract(pair, '$[0]') AS value, json_extract(pair, '$[1]') AS label
    FROM g2b_prior_spec_list_businesses WHERE uses > 0 ORDER BY label, value`);

  return {
    /**
     * 저장 사전규격에 기록된 업무구분 선택지를 표시 순으로 읽는다.
     * 조회 행에서 값과 라벨만 복사해 React에 전달할 선택지를 구성한다.
     * @returns 조회 순서대로 값과 라벨을 담은 일반 객체 목록.
     * @throws Turso에서 선택지 조회가 실패한 경우.
     */
    async businesses() {
      // 집계에 남아 있는 업무구분을 정렬된 순서로 읽는다.
      const rows = await options.all() as { value: string; label: string }[];
      // libSQL이 열 접근에 사용하는 숨은 속성을 제외하고 화면용 선택지를 반환한다.
      return rows.map(
        /**
         * 조회 행의 업무 코드와 라벨을 일반 객체에 담는다.
         * @param row 업무구분의 값과 라벨이 들어 있는 조회 행.
         * @returns 화면에 전달할 값과 라벨만 담은 선택지.
         */
        ({ value, label }) => ({ value, label }),
      );
    },

    /**
     * 검색과 필터를 적용해 상태별 건수를 계산하고 보정한 페이지의 상세값을 같은 스냅샷에서 읽는다.
     * @param query 화면의 검증된 검색, 필터, 정렬, 상태 및 페이지.
     * @returns 상태별 건수와 페이지 정보 및 표시할 사전규격 행.
     * @throws Turso에서 목록 조회가 실패한 경우.
     */
    async page(query: CollectionListQuery) {
      // 공통 목록과 동일한 사전규격번호·접수번호 검색, 업무구분 및 날짜 비교 조건을 적용한다.
      const { where, values, order, ascending } = collectionListCriteria(query, budgetConditions);
      const criteria = ["visible = 1", ...where].join(" AND ");
      const direction = ascending ? "ASC NULLS LAST" : "DESC";
      const status = query.status === "collected" ? "collected_at IS NOT NULL"
        : query.status === "uncollected" ? "collected_at IS NULL" : "TRUE";
      // 기본 조회는 사전 집계 한 행을 사용하고 검색·필터 조회는 조건에 맞는 키를 센다.
      const totals = where.length
        ? `SELECT COUNT(*) AS total, COUNT(collected_at) AS collected FROM g2b_prior_spec_list WHERE ${criteria}`
        : "SELECT total, collected FROM g2b_collection_list_counts WHERE section = 'prior-specs' AND scope = 'all'";
      const selected = query.status === "collected" ? "collected" : query.status === "uncollected" ? "total - collected" : "total";
      // 정렬과 페이지 경계를 먼저 확정해 원본 사전규격과 최신 시도는 선택한 키에 한해서 조회한다.
      const sql = `WITH totals AS MATERIALIZED (${totals}),
        paged AS MATERIALIZED (
          SELECT number, revision, opening_revision, collected_at, latest_id, ${order} AS sortValue
          FROM g2b_prior_spec_list WHERE ${criteria} AND ${status}
          ORDER BY ${order} ${direction}, number, revision, opening_revision
          LIMIT ${pageSize} OFFSET (
            SELECT (max(1, min(?, ((${selected}) + ${pageSize - 1}) / ${pageSize})) - 1) * ${pageSize} FROM totals
          )
        )
        SELECT paged.number, paged.revision, paged.opening_revision AS openingRevision,
          paged.collected_at AS collectedAt, json_extract(saved.data, '$.payload.dlBfSpecM.bfSpecNm') AS title,
          CAST(json_extract(saved.data, '$.payload.dlBfSpecM.prcmBsneSeCd') AS TEXT) AS businessCode,
          json_extract(saved.data, '$.payload.dlBfSpecM.prcmBsneSeCdNm') AS businessLabel,
          attempt.id, attempt.started_at AS startedAt, attempt.status, attempt.error, paged.sortValue,
          totals.total, totals.collected, ${selected} AS selectedCount, attempt.diagnostics
        FROM totals LEFT JOIN paged ON TRUE
        LEFT JOIN prior_specs saved ON paged.collected_at IS NOT NULL AND saved.number = paged.number
        LEFT JOIN g2b_collection_attempts attempt ON attempt.id = paged.latest_id
        ORDER BY paged.sortValue ${direction}, paged.number, paged.revision, paged.opening_revision`;
      // 조건 인자를 집계와 페이지에 각각 전달한 뒤 빈 목록에서도 반환되는 집계 행을 사용한다.
      const rows = await db.prepare(sql).all(...values, ...values, query.page) as
        (CollectionListRow & { total: number; collected: number; selectedCount: number })[];
      const { total, collected, selectedCount } = rows[0];
      const totalPages = Math.ceil(selectedCount / pageSize);
      // 기존 응답 구조를 유지하고 집계용 빈 행은 목록에서 제외한다.
      return {
        counts: { total, collected, uncollected: total - collected },
        page: Math.max(1, Math.min(query.page, totalPages)),
        totalPages,
        rows: rows.filter((row) => row.number !== null),
      };
    },
  };
}
