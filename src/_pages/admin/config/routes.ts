import { revisionRoute, type NumberWithRevision } from "@/shared/lib/g2b/revision-route";

/** 관리자 대시보드와 나라장터 하위 경로의 기준 주소. */
export const ADMIN_HOME_PATH = "/admin";
export const ADMIN_G2B_PATH = `${ADMIN_HOME_PATH}/g2b`;
// 관리 기능과 사전 목록 화면의 기준 경로다.
export const ADMIN_MANAGE_PATH = `${ADMIN_HOME_PATH}/manage`;
export const ADMIN_DICTIONARIES_PATH = `${ADMIN_MANAGE_PATH}/dictionaries`;
export const NOTICE_QUEUE_PATH = `${ADMIN_G2B_PATH}/notice-queue`;
export const NOTICE_LIST_PATH = `${ADMIN_G2B_PATH}/notices`;
// 업종 및 근거법규 목록 페이지의 경로다.
export const ADMIN_INDUSTRY_LAW_PATH = `${ADMIN_DICTIONARIES_PATH}/industry-law`;
// 법정동 코드 목록 페이지의 경로다.
export const ADMIN_LEGAL_DISTRICTS_PATH = `${ADMIN_DICTIONARIES_PATH}/legal-districts`;

/** 공고번호와 차수를 URL 세그먼트로 인코딩해 관리자 공고 상세로 연결한다. */
export function noticePath(key: NumberWithRevision) {
  return `${ADMIN_G2B_PATH}${revisionRoute("notices", key)}`;
}

/**
 * 저장된 발주계획의 상세 경로를 만든다.
 * @param number 나라장터 발주계획번호.
 * @returns 앱의 발주계획 상세 경로.
 */
export function orderPlanPath(number: string) {
  return `${ADMIN_G2B_PATH}/order-plans/${encodeURIComponent(number)}`;
}

/**
 * 사전규격 상세 경로를 만든다.
 * @param number 사전규격등록번호.
 * @returns 앱의 사전규격 상세 경로.
 */
export function priorSpecPath(number: string) {
  return `${ADMIN_G2B_PATH}/prior-specs/${encodeURIComponent(number)}`;
}

/**
 * 관리자 계약현황 상세 화면으로 연결한다.
 * @param key 계약번호와 정규화된 변경차수.
 */
export function contractPath(key: NumberWithRevision) {
  return `${ADMIN_G2B_PATH}${revisionRoute("contracts", key)}`;
}

/**
 * 관리자 계약요청 상세 화면으로 연결한다.
 * @param key 계약요청접수번호와 차수.
 */
export function contractRequestPath(key: NumberWithRevision) {
  return `${ADMIN_G2B_PATH}${revisionRoute("contract-requests", key)}`;
}

/**
 * 관리자 개찰결과 상세 화면으로 연결한다.
 * @param key 입찰공고번호와 차수.
 */
export function openingResultPath(key: NumberWithRevision) {
  return `${ADMIN_G2B_PATH}${revisionRoute("opening-results", key)}`;
}

// 목록 링크와 수집 성공 후 이동에 같은 상세 경로를 사용한다.
export const collectionDetailPaths = {
  "order-plans": ({ number }: NumberWithRevision) => orderPlanPath(number),
  "contract-requests": contractRequestPath,
  "prior-specs": ({ number }: NumberWithRevision) => priorSpecPath(number),
  notices: noticePath,
  "opening-results": openingResultPath,
  contracts: contractPath,
};
