/**
 * 나라장터 상세 경로에 사용할 번호를 정리한다.
 * @param value API에서 받은 등록번호.
 * @returns 공백을 제거한 유효한 번호 또는 undefined.
 */
export function g2bNumber(value: unknown) {
  if (typeof value === 'string' && /^[A-Z0-9-]{1,30}$/.test(value.trim())) return value.trim();
}
