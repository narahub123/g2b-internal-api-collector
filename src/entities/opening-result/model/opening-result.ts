import { g2bNumber } from '@/shared/model/g2b-number';

export type OpeningResultKey = { number: string; revision: string; openingRevision: string };
export type OpeningResultQuery = OpeningResultKey & { classification: string; businessCode: string };

export type OpeningResult = OpeningResultKey & {
  collectedAt: string;
  results: { query: OpeningResultQuery; detail: Record<string, unknown> }[];
};

function revision(value: unknown) {
  const text = String(value ?? '');
  return /^\d{1,3}$/.test(text) ? text.padStart(3, '0') : undefined;
}

/**
 * 입찰 진행 현황 행에서 유찰 상세 조회 조건을 읽는다.
 * @param row 공고 상세의 입찰 진행 현황 행.
 * @param notice 공고 상세의 기본 정보.
 * @returns 단일 분류의 유찰 상세 조회 조건 또는 undefined.
 */
export function openingResultQuery(row: Record<string, unknown>, notice: Record<string, unknown>): OpeningResultQuery | undefined {
  // 분류 조회용 집계 행과 낙찰 등 다른 상태는 별도의 나라장터 화면을 사용한다.
  if (row.bidClsfYn === 'Y' || (row.bidPgstCd !== '입160005' && row.bidPgstNm !== '유찰')) return;
  const number = g2bNumber(row.bidPbancNo);
  const noticeRevision = revision(row.bidPbancOrd);
  const openingRevision = revision(row.bidPrgrsOrd);
  const classification = String(row.bidClsfNo ?? '');
  const businessCode = String(notice.prcmBsneSeCd ?? '');
  if (!number || number !== notice.bidPbancNo || !noticeRevision || noticeRevision !== revision(notice.bidPbancOrd) ||
      !openingRevision || !/^\d+$/.test(classification) || !/^\d{2}$/.test(businessCode)) return;
  return { number, revision: noticeRevision, openingRevision, classification, businessCode };
}

/**
 * 저장된 공고에서 유찰 상세를 조회할 수 있는 행을 찾는다.
 * @param payload 공고 상세 API 원본 응답.
 * @returns 개찰차수 및 분류 기준으로 중복을 제거한 조회 조건.
 */
export function openingResultQueries(payload: Record<string, unknown>) {
  const notice = payload.dmItemMap as Record<string, unknown> | undefined;
  const rows = payload.dlBidBasePgstL;
  const queries = new Map<string, OpeningResultQuery>();
  if (!notice || !Array.isArray(rows)) return [];
  for (const row of rows) {
    const query = row && openingResultQuery(row, notice);
    if (query) queries.set(`${query.openingRevision}/${query.classification}`, query);
  }
  return [...queries.values()];
}

/**
 * 개찰차수별로 조회 조건을 묶는다.
 * @param queries 같은 공고번호와 공고차수에 속하는 조회 조건.
 * @returns 개찰차수를 키로 하는 조회 조건 목록.
 */
export function groupOpeningResultQueries(queries: OpeningResultQuery[]) {
  const groups = new Map<string, OpeningResultQuery[]>();
  for (const query of queries) {
    const group = groups.get(query.openingRevision);
    if (group) group.push(query);
    else groups.set(query.openingRevision, [query]);
  }
  return groups;
}

/**
 * 개찰결과의 상세 경로를 만든다.
 * @param key 공고번호와 공고차수.
 * @returns 앱의 개찰결과 상세 경로.
 */
export function openingResultPath({ number, revision }: Pick<OpeningResultKey, 'number' | 'revision'>) {
  return `/opening-results/${encodeURIComponent(number)}/${encodeURIComponent(revision)}`;
}
