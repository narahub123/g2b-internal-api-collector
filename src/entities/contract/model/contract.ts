import { g2bNumber } from "@/shared/model/g2b-number";
import type { NoticeKey } from "@/entities/notice/model/types";

export type ContractKey = { number: string; revision: string };
type RecordRow = Record<string, unknown>;
type ContractData = {
  detail: RecordRow;
  companies: RecordRow[];
  services: RecordRow[];
  items: RecordRow[];
};
export type Contract = ContractKey & ContractData & { collectedAt: string };

/** 계약변경차수를 최소 두 자리로 정규화한다.
 * @param value 나라장터 응답 또는 경로의 변경차수.
 * @returns 정규화된 차수. 숫자 한 자리부터 세 자리까지 허용한다.
 */
export function contractRevision(value: unknown) {
  if (
    (typeof value === "string" || typeof value === "number") &&
    /^\d{1,3}$/.test(String(value).trim())
  ) {
    return String(Number(value)).padStart(2, "0");
  }
}

/** 해당 공고의 계약 식별자를 업무 진행 응답 순서로 추출한다.
 * @param rows 업무 진행 응답의 행 목록.
 * @param notice 대상 공고번호와 세 자리 차수.
 * @returns 유효한 계약번호와 변경차수의 중복 없는 목록.
 */
export function contractKeys(rows: RecordRow[], notice: NoticeKey) {
  const keys = new Map<string, ContractKey>();
  for (const row of rows) {
    if (
      g2bNumber(row?.bidPbancNo) !== notice.number ||
      contractRevision(row?.bidPbancOrd)?.padStart(3, "0") !== notice.revision
    )
      continue;
    const number = g2bNumber(row.ctrtNo);
    const revision = contractRevision(row.ctrtChgOrd);
    if (number && revision)
      keys.set(`${number}/${revision}`, { number, revision });
  }
  return [...keys.values()];
}

/** 공개 계약현황 상세 조회의 요청 본문을 구성한다.
 * @param key 계약번호와 정규화된 변경차수.
 * @returns 나라장터 조회 파라미터 맵을 담은 요청 본문.
 */
export function contractSearchBody({ number, revision }: ContractKey) {
  return {
    dlSrchParamM: {
      untyInspIgiNo: "",
      untyPyprNo: "",
      ctrtDmndRcptNo: "",
      ctrtDmndRcptOrd: "",
      page: "1",
      pageSize: "10",
      ctrtNo: number,
      ctrtChgOrd: revision,
      bizNo: "",
      bizOrd: "",
      prcmBsneSeCd: "",
    },
  };
}

function isRecord(value: unknown): value is RecordRow {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRows(value: unknown): value is RecordRow[] {
  return Array.isArray(value) && value.every(isRecord);
}

/** 응답이 요청한 계약에 해당하고 네 데이터셋이 모두 유효한지 확인한다.
 * @param key 요청한 계약번호와 정규화된 변경차수.
 * @param response 나라장터 계약 상세 응답.
 * @returns 저장할 상세와 목록. 불일치 또는 응답 형식 오류 시 undefined.
 */
export function parseContractResponse(
  key: ContractKey,
  response: unknown,
): ContractData | undefined {
  if (!isRecord(response)) return;
  const {
    dlCtrtMngLstM: detail,
    dlCtrtEtpsLstL: companies,
    dlCtrtEtpsSvsLstL: services,
    dlCtrtItemLstL: items,
  } = response;
  if (
    !isRecord(detail) ||
    detail.ctrtNo !== key.number ||
    contractRevision(detail.ctrtChgOrd) !== key.revision ||
    !isRows(companies) ||
    !isRows(services) ||
    !isRows(items)
  )
    return;
  return { detail, companies, services, items };
}

function contractRoute({ number, revision }: ContractKey) {
  return `/contracts/${encodeURIComponent(number)}/${encodeURIComponent(revision)}`;
}

/**
 * 관리자 계약현황 상세 화면으로 연결한다.
 * @param key 계약번호와 정규화된 변경차수.
 */
export function contractPath(key: ContractKey) {
  return `/admin${contractRoute(key)}`;
}

/**
 * 계약현황 재수집 요청에 쓰는 API 주소를 만든다.
 * @param key 계약번호와 정규화된 변경차수.
 */
export function contractApiPath(key: ContractKey) {
  return `/api${contractRoute(key)}`;
}
