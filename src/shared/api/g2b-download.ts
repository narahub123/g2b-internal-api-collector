const markers = [[8, 'r'], [6, 'a'], [9, 'o'], [7, 'n'], [8, 'w'], [6, 'i'], [9, 'z']] as const;

/**
 * 검증된 첨부 메타데이터로 나라장터 RAON 다운로드 주소를 만든다.
 * @param fields RAON 요청에 전달할 검증된 필드. 핸들러에 전달할 순서대로 제공한다.
 * @param query 핸들러가 별도로 요구하는 추가 쿼리 파라미터.
 * @returns 나라장터 다운로드 URL.
 */
export function g2bDownloadUrl(fields: Record<string, string>, query: Record<string, string> = {}) {
  let encoded = Buffer.from(Object.entries(fields).map(([key, value]) => `${key}\f${value}`).join('\x0b')).toString('base64');
  for (const [index, marker] of markers) encoded = encoded.slice(0, index) + marker + encoded.slice(index);

  const url = new URL('/fs/fsc/fsca/fileUpload.do', 'https://www.g2b.go.kr');
  url.search = new URLSearchParams({ k00: encoded.replaceAll('+', '%2B'), ...query }).toString();
  return url;
}
