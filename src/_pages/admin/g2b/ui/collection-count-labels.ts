// 랜딩 카드와 업무 목록에서 같은 순서와 명칭으로 집계를 표시한다.
export const collectionCountLabels = [
  ["total", "전체"],
  ["collected", "수집"],
  ["uncollected", "미수집"],
] as const;

export const collectionCountFormat = new Intl.NumberFormat("ko-KR");
