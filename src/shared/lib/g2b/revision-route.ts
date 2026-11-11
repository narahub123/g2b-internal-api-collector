// 업무 화면과 API에서 동일한 번호·차수 형식을 사용한다.
export type NumberWithRevision = { number: string; revision: string };

/**
 * 번호와 차수를 각각 URL 세그먼트로 인코딩한 업무 경로를 반환한다.
 * @param section 호출자가 지정한 나라장터 업무 경로 세그먼트.
 */
export function revisionRoute(section: string, { number, revision }: NumberWithRevision) {
  return `/${section}/${encodeURIComponent(number)}/${encodeURIComponent(revision)}`;
}
