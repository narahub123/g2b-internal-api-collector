/**
 * 개별 원본 요청과 전체 수집의 제한 시간을 함께 적용한다.
 * @param fetchImpl 테스트에서 주입하거나 기본으로 사용할 요청 함수.
 * @param signal 저장소가 관리하는 수집 제한.
 * @returns 원본 요청에 사용할 함수.
 */
export function collectionFetch(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): typeof fetch {
  if (!signal) return fetchImpl;
  return request;

  /**
   * 원본이 정한 시간을 유지하면서 수집 전체가 중단될 때도 요청을 취소한다.
   * @param input 원본 주소 또는 요청.
   * @param init 요청의 추가 설정.
   * @returns 원본 응답.
   */
  function request(input: RequestInfo | URL, init?: RequestInit) {
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return fetchImpl(input, { ...init, signal: requestSignal ? AbortSignal.any([requestSignal, signal]) : signal });
  }
}
