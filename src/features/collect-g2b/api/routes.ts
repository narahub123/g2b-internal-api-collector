import { revisionRoute, type NumberWithRevision } from "@/shared/lib/g2b/revision-route";

/**
 * 계약현황 재수집 요청에 쓰는 API 주소를 만든다.
 * @param key 계약번호와 정규화된 변경차수.
 */
export function contractApiPath(key: NumberWithRevision) {
  return `/api${revisionRoute("contracts", key)}`;
}

/**
 * 계약요청 재수집 요청에 쓰는 API 주소를 만든다.
 * @param key 계약요청접수번호와 차수.
 */
export function contractRequestApiPath(key: NumberWithRevision) {
  return `/api${revisionRoute("contract-requests", key)}`;
}

/**
 * 개찰결과 재수집 요청에 쓰는 API 주소를 만든다.
 * @param key 입찰공고번호와 차수.
 */
export function openingResultApiPath(key: NumberWithRevision) {
  return `/api${revisionRoute("opening-results", key)}`;
}
