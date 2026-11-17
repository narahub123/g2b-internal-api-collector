const pageSize = 20;

/** 저장된 건수로 페이지를 보정하고, 가까운 쪽부터 훑어 깊은 페이지의 인덱스 이동을 줄인다. */
export function noticePageWindow(requested: number, count: number) {
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const page = Math.min(totalPages, Math.max(1, requested));
  const start = (page - 1) * pageSize;
  const limit = Math.max(0, Math.min(pageSize, count - start));
  const fromEnd = count - start - limit;
  const reverse = fromEnd < start;
  return { page, totalPages, limit, offset: reverse ? fromEnd : start, reverse };
}
