/**
 * 나라장터 첨부파일 API의 fileSz(바이트)를 화면에 표시할 크기로 변환한다.
 *
 * - 1024바이트를 1KB로 계산한다.
 * - 1KB 미만은 B, 이후 KB / MB / GB / TB 단위를 사용한다.
 * - KB 이상은 소수 둘째 자리까지 표시하되 불필요한 0은 제거한다.
 * - 값이 없거나 유효하지 않으면 undefined를 반환하여 기존 표의 빈값 처리와 호환한다.
 * - 원본 fileSz 값은 변경하지 않는다.
 *
 * @param value 첨부파일 목록 응답의 fileSz (number 또는 숫자 문자열)
 * @returns 예: "850 B", "1 KB", "1.5 MB"; 유효하지 않으면 undefined
 */
export function formatAttachmentFileSize(value: unknown): string | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return undefined;
  }

  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0) return undefined;

  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const formatted = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: unitIndex === 0 ? 0 : 2,
  }).format(size);

  return `${formatted} ${units[unitIndex]}`;
}
