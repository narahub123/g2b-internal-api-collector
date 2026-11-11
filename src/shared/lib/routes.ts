/** 관리자 대시보드와 나라장터 하위 경로의 기준 주소. */
export const ADMIN_HOME_PATH = "/admin";
export const ADMIN_G2B_PATH = `${ADMIN_HOME_PATH}/g2b`;
export const NOTICE_LIST_PATH = `${ADMIN_G2B_PATH}/notices`;

// 화면 이동과 API 요청이 같은 식별자 인코딩 규칙을 사용한다.
type NumberWithRevision = { number: string; revision: string };

function revisionRoute(section: string, { number, revision }: NumberWithRevision) {
  return `/${section}/${encodeURIComponent(number)}/${encodeURIComponent(revision)}`;
}

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

function contractRoute(key: NumberWithRevision) {
  return revisionRoute("contracts", key);
}

/**
 * 관리자 계약현황 상세 화면으로 연결한다.
 * @param key 계약번호와 정규화된 변경차수.
 */
export function contractPath(key: NumberWithRevision) {
  return `${ADMIN_G2B_PATH}${contractRoute(key)}`;
}

/**
 * 계약현황 재수집 요청에 쓰는 API 주소를 만든다.
 * @param key 계약번호와 정규화된 변경차수.
 */
export function contractApiPath(key: NumberWithRevision) {
  return `/api${contractRoute(key)}`;
}

function contractRequestRoute(key: NumberWithRevision) {
  return revisionRoute("contract-requests", key);
}

/**
 * 관리자 계약요청 상세 화면으로 연결한다.
 * @param key 계약요청접수번호와 차수.
 */
export function contractRequestPath(key: NumberWithRevision) {
  return `${ADMIN_G2B_PATH}${contractRequestRoute(key)}`;
}

/**
 * 계약요청 재수집 요청에 쓰는 API 주소를 만든다.
 * @param key 계약요청접수번호와 차수.
 */
export function contractRequestApiPath(key: NumberWithRevision) {
  return `/api${contractRequestRoute(key)}`;
}

function openingResultRoute(key: NumberWithRevision) {
  return revisionRoute("opening-results", key);
}

/**
 * 관리자 개찰결과 상세 화면으로 연결한다.
 * @param key 입찰공고번호와 차수.
 */
export function openingResultPath(key: NumberWithRevision) {
  return `${ADMIN_G2B_PATH}${openingResultRoute(key)}`;
}

/**
 * 개찰결과 재수집 요청에 쓰는 API 주소를 만든다.
 * @param key 입찰공고번호와 차수.
 */
export function openingResultApiPath(key: NumberWithRevision) {
  return `/api${openingResultRoute(key)}`;
}
