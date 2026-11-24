import type { G2bDatabase, SQLInputValue } from "./database";
import type { NoticeListQuery } from "@/entities/notice/model/notice-list-query";
import { etcNoticeDetail, isMockNotice, noticeDetail } from "@/entities/notice/model/notice-detail";
import type { Notice } from "@/entities/notice/model/types";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { appendCollectionDateRange, cleanText, searchText, sortDate } from "./collection-list-query";
import { queryNoticePage } from "./notice-list-page";
import { withListSearch } from "./number-search";
import { withNoticeRegionKeys } from "./notice-region-search";

// 사용자 입찰공고의 조회 결과, 집계, 선택지에 같은 노출 기준을 적용한다.
type NoticeListOptions = { excludeMockNotices?: boolean };

/** 사용자 목록에서 제외할 모의공고인지 판정한다. */
export function mockNoticeFlag(raw: SQLInputValue) {
  if (typeof raw !== "string") return 0;
  const notice = JSON.parse(raw) as Notice | null;
  return Number(notice !== null && isMockNotice(notice));
}

const sortColumns = new Map([
  ["posted", "posted"],
  ["submission", "submission"],
  ["deadline", "deadline"],
  ["title", "sortTitle"],
  ["budget", "budget"],
]);

/** 나라장터 지역 제한 문구를 중복 없는 선택지로 나눈다. */
export function regionsFrom(raw: unknown) {
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

/** 수집 원본에서 목록 검색과 정렬에 필요한 파생값을 계산한다. */
export function noticeFields(raw: unknown) {
  const { payload = {}, title } =
    (typeof raw === "string" ? JSON.parse(raw) : null) ?? {};
  const detail = noticeDetail(payload ?? {});
  const isEtc = Boolean(etcNoticeDetail(payload ?? {}));
  const business = resolveG2bBusiness(detail.prcmBsneSeCd, detail.prcmBsneSeNm);
  // 같은 시작 코드가 공동수급협정서에도 있으므로 입찰서 제출 종료 코드로 행을 구분한다.
  const schedule = Array.isArray(payload?.dmItemList1)
    ? payload.dmItemList1
    : [];
  const submission =
    schedule.find((item) => item?.endDtNm === "BIDPBANC_SLPRRCPTDDLNDT") ??
    schedule.find(
      (item) => cleanText(item?.subject).replace(/\s+/g, "") === "입찰서제출",
    );
  const budget = isEtc ? detail.bgtAmt : detail.alotBgtAmt;
  const amount =
    typeof budget === "number" ||
    (typeof budget === "string" && /^[+-]?\d+(?:\.\d+)?$/.test(budget.trim()))
      ? Number(budget)
      : null;
  const agencies = [isEtc ? detail.dmstNm : detail.dmstUntyGrpNm];
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
    submission: sortDate(isEtc ? detail.slprRcptBgngDt : submission?.startDt),
    deadline: sortDate(isEtc ? detail.slprRcptDdlnDt : submission?.endDt),
    sortTitle: cleanText(title || detail.bidPbancNm) || null,
    agencies: [...new Set(agencies.map(cleanText).filter(Boolean))],
    budget: Number.isFinite(amount) ? amount : null,
    business: business?.code ?? business?.label ?? null,
    regions: detail.rgnLmtYn === "Y" ? regionsFrom(detail.rgnLmtCn) : [],
    unrestrictedRegion,
  });
}

/**
 * 저장 공고와 수집 이력을 합친 목록에서 입찰공고 조회를 준비한다.
 * @param db 입찰공고 전용 목록 및 선택지 집계를 조회하는 저장소 연결.
 * @throws Turso에서 함수 등록 또는 조회문 준비가 실패한 경우.
 */
export function openNoticeList(db: G2bDatabase) {
  // 화면별로 한 건 이상 사용 중인 선택지의 원래 값을 조회한다.
  const choices = db.prepare(`
    SELECT value FROM g2b_notice_list_options
    WHERE kind = ? AND (CASE WHEN ? THEN visible ELSE total END) > 0
    ORDER BY json_extract(value, '$')
  `);

  return {
    /**
     * 저장된 공고의 업무구분을 목록 배지와 같은 이름으로 반환한다.
     * @param options 사용자 목록을 구성할 때 모의공고의 업무구분을 제외할지 지정한다.
     * @throws Turso에서 업무구분을 읽지 못한 경우.
     */
    async businesses({ excludeMockNotices = false }: NoticeListOptions = {}) {
      const options = new Map<string, string>();
      // 원본 코드와 명칭을 복원해 기존 업무구분 정규화 규칙을 적용한다.
      for (const { value } of await choices.all("business", Number(excludeMockNotices))) {
        const [code, label] = JSON.parse(String(value));
        const business = resolveG2bBusiness(code, label);
        if (business) options.set(business.code ?? business.label, business.label);
      }
      return [...options].map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "ko"));
    },
    /**
     * 수집 상태에 관계없이 저장된 공고에서 명시적으로 표시되는 참가 가능 지역을 조회한다.
     * @param options 사용자 목록을 구성할 때 모의공고의 지역을 제외할지 지정한다.
     * @throws Turso에서 공고 자료를 읽지 못한 경우.
     */
    async regions({ excludeMockNotices = false }: NoticeListOptions = {}): Promise<string[]> {
      // 원래 지역 이름을 복원하고 조회 순서대로 반환한다.
      return (await choices.all("region", Number(excludeMockNotices))).map(({ value }) => JSON.parse(String(value)));
    },

    /**
     * 검색·필터에 일치하는 수집 상태별 건수와 선택된 상태의 현재 페이지를 함께 조회한다.
     * @param query 정규화할 검색어, 필터, 정렬과 요청 페이지.
     * @param options 모의공고를 제외하면 검색 결과와 건수 및 페이지 수에 같은 조건을 적용한다.
     * @returns 범위를 벗어난 페이지는 마지막 페이지로 보정하며, 값 없는 행은 정렬 방향에 관계없이 뒤에 둔다.
     * @throws Turso에서 검색 또는 집계에 실패한 경우.
     */
    page(query: NoticeListQuery, { excludeMockNotices = false }: NoticeListOptions = {}) {
      // 사용자 노출 범위와 별개로 검색 및 필터의 조건과 바인딩 값을 모은다.
      const where: string[] = [];
      const values: SQLInputValue[] = [];
      // 상세 화면의 하이픈과 목록의 슬래시 모두 같은 공고번호·차수로 검색한다.
      const search =
        query.search.field === "number"
          ? query.search.query.replace(/[\s/-]+/g, "")
          : query.search.query;
      // 최종 부분 일치에 전달하는 동일한 검색어로 후보 조각을 계산한다.
      const keyword = search ? searchText(search) : "";
      if (search) {
        const match =
          query.search.field === "number"
            ? "instr(lower(number || revision), ?) > 0"
            : query.search.field === "agency"
              ? "EXISTS (SELECT 1 FROM json_each(fields, '$.agencies') WHERE instr(value, ?) > 0)"
              : "instr(json_extract(fields, '$.searchTitle'), ?) > 0";
        where.push(match);
        values.push(keyword);
      }
      // 날짜 경계는 게시일 열과 제출 시작일 인덱스의 표현식에 직접 적용한다.
      appendCollectionDateRange(where, values, "posted", query.filters.posted);
      appendCollectionDateRange(where, values, "json_extract(fields, '$.submission')", query.filters.submission);
      // 예산은 JSON에 저장한 숫자에 기존의 포함 범위를 적용한다.
      const budget = query.filters.budget;
      if (budget && ("from" in budget || "to" in budget)) {
        // 최솟값이 지정된 경우 같거나 큰 예산을 선택한다.
        if (budget.from !== undefined) {
          where.push("json_extract(fields, '$.budget') >= ?");
          values.push(budget.from);
        }
        // 최댓값이 지정된 경우 같거나 작은 예산을 선택한다.
        if (budget.to !== undefined) {
          where.push("json_extract(fields, '$.budget') <= ?");
          values.push(budget.to);
        }
      }
      const selected = query.filters.region;
      if (Array.isArray(selected) && selected.length) {
        where.push(
          "(json_extract(fields, '$.unrestrictedRegion') = 1 OR EXISTS (SELECT 1 FROM json_each(fields, '$.regions') WHERE value IN (SELECT value FROM json_each(?))))",
        );
        values.push(JSON.stringify(selected));
      }
      const business = query.filters.business;
      if (Array.isArray(business) && business.length) {
        where.push("json_extract(fields, '$.business') IN (SELECT value FROM json_each(?))");
        values.push(JSON.stringify(business));
      }
      const [field, direction] = query.sort.split("-");
      const order = sortColumns.get(field) ?? "posted";
      // 지원하는 검색에만 공통 후보 탐색을 적용한다.
      const pageOptions = { where, values, order, ascending: direction === "asc", excludeMockNotices };
      // 날짜 범위가 활성화되면 기존 날짜 인덱스가 후보를 좁히도록 한다.
      const dateFiltered = Boolean(query.filters.posted || query.filters.submission);
      /**
       * 기존 글자 조각이나 날짜로 후보를 줄이지 못한 지역 요청에만 매핑을 확인한다.
       * @param grams 검색에서 이미 좁힌 조각.
       * @returns 같은 스냅샷에서 계산한 집계와 페이지.
       */
      return withListSearch(db, "notices", query.search, (grams) => {
        // 글자 조각이 없고 날짜 범위를 쓰지 않는 지역 요청만 제한된 매핑을 읽는다.
        if (Array.isArray(selected) && selected.length && !dateFiltered && !grams.length) {
          return withNoticeRegionKeys(db, selected, (regionalKeys) =>
            queryNoticePage(db, query, { ...pageOptions, grams, regionalKeys }));
        }
        // 기존 인덱스 후보와 지역 필터의 결과를 집계와 페이지에서 함께 사용한다.
        return queryNoticePage(db, query, { ...pageOptions, grams });
      });
    },
  };
}
