import { g2bNumber } from "@/shared/model/g2b-number";

export type ContractRequestKey = { number: string; revision: string };

export type ContractRequest = ContractRequestKey & {
  collectedAt: string;
  detail: Record<string, unknown>;
  items: Record<string, unknown>[];
};

/**
 * 나라장터 API에서 받은 차수를 세 자리로 정규화한다.
 * @param value API 응답의 차수.
 * @returns 세 자리 차수 또는 undefined.
 */
export function contractRequestRevision(value: unknown) {
  if (
    (typeof value === "string" || typeof value === "number") &&
    /^\d{1,3}$/.test(String(value).trim())
  ) {
    return String(value).trim().padStart(3, "0");
  }
}

/**
 * 업무 진행 응답에서 대상 공고에 연결된 계약요청을 찾는다.
 * @param rows 업무 진행 API 목록. 다른 공고와 분류 행이 섞일 수 있다.
 * @param notice 대상 공고번호와 차수.
 * @returns 중복을 제거한 계약요청 번호와 차수.
 */
export function contractRequestKeys(
  rows: Record<string, unknown>[],
  notice: ContractRequestKey,
) {
  const requests = new Map<string, ContractRequestKey>();
  for (const row of rows) {
    if (
      g2bNumber(row?.bidPbancNo) !== notice.number ||
      contractRequestRevision(row?.bidPbancOrd) !== notice.revision
    )
      continue;
    const number = g2bNumber(row.ctrtDmndRcptNo);
    const revision = contractRequestRevision(row.ctrtDmndRcptOrd);
    if (number && revision)
      requests.set(`${number}/${revision}`, { number, revision });
  }
  return [...requests.values()];
}

function contractRequestRoute({ number, revision }: ContractRequestKey) {
  return `/contract-requests/${encodeURIComponent(number)}/${encodeURIComponent(revision)}`;
}

/**
 * 관리자 계약요청 상세 화면으로 연결한다.
 * @param key 계약요청접수번호와 차수.
 */
export function contractRequestPath(key: ContractRequestKey) {
  return `/admin${contractRequestRoute(key)}`;
}

/**
 * 계약요청 재수집 요청에 쓰는 API 주소를 만든다.
 * @param key 계약요청접수번호와 차수.
 */
export function contractRequestApiPath(key: ContractRequestKey) {
  return `/api${contractRequestRoute(key)}`;
}
