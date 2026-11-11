export type ListOption = { value: string; label: string };

export type ListSearchValue = { field: string; query: string };

type FilterBase = { id: string; label: string };

// 숫자와 날짜의 경계는 하나만 지정할 수 있다. 비어 있는 필터는 적용값에 포함하지 않는다.
export type ListFilter =
  | (FilterBase & { type: "date-range" })
  | (FilterBase & { type: "number-range"; unit?: string })
  | (FilterBase & { type: "multi-select"; options: readonly ListOption[] });

type Range<T> = { from?: T; to?: T };
export type ListFilterValues = Record<string, Range<string> | Range<number> | readonly string[]>;
type FilterDraft = Record<string, Range<string | number> | readonly string[]>;

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseNumber(value: string) {
  if (!value) return undefined;
  // 16진수, 무한대처럼 일반 숫자 필드에서 의도하지 않은 표기를 제외한다.
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
    ? Number(value)
    : NaN;
}

/**
 * 필터 설정에 등록된 값만 검증해 적용 가능한 값과 필드별 오류를 반환한다.
 * 날짜와 숫자 범위의 한쪽 경계는 생략할 수 있으며 빈 조건은 결과에 포함하지 않는다.
 */
export function validateFilters(filters: readonly ListFilter[], draft: FilterDraft) {
  const values = new Map<string, ListFilterValues[string]>();
  const errors = new Map<string, string>();

  for (const filter of filters) {
    const value = Object.hasOwn(draft, filter.id) ? draft[filter.id] : undefined;
    if (filter.type === "multi-select") {
      const selected = new Set(Array.isArray(value) ? value : []);
      const choices = filter.options.filter(({ value }) => selected.has(value)).map(({ value }) => value);
      if (choices.length) values.set(filter.id, choices);
      continue;
    }

    const range = !value || Array.isArray(value) ? {} : value as Range<string | number>;
    const from = String(range.from ?? "").trim();
    const to = String(range.to ?? "").trim();
    if (!from && !to) continue;

    if (filter.type === "date-range") {
      if ((from && !isDate(from)) || (to && !isDate(to))) {
        errors.set(filter.id, "올바른 날짜를 입력하세요.");
      } else if (from && to && from > to) {
        errors.set(filter.id, "시작일은 종료일보다 늦을 수 없습니다.");
      } else {
        values.set(filter.id, { ...(from && { from }), ...(to && { to }) });
      }
      continue;
    }

    const min = parseNumber(from);
    const max = parseNumber(to);
    if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max))) {
      errors.set(filter.id, "올바른 숫자를 입력하세요.");
    } else if (min !== undefined && max !== undefined && min > max) {
      errors.set(filter.id, "최솟값은 최댓값보다 클 수 없습니다.");
    } else {
      values.set(filter.id, {
        ...(min !== undefined && { from: min }),
        ...(max !== undefined && { to: max }),
      });
    }
  }

  return { values: Object.fromEntries(values), errors: Object.fromEntries(errors) };
}

/**
 * 현재 페이지 주변의 번호를 최대 5개 계산한다. 첫·마지막 페이지에서는 범위를 안쪽으로 이동한다.
 * @param page 1부터 시작하는 현재 페이지. 범위 밖이면 가장 가까운 페이지를 사용한다.
 * @param totalPages 전체 페이지 수. 0 이하이면 번호를 반환하지 않는다.
 */
export function getPageNumbers(page: number, totalPages: number): number[] {
  const size = Math.max(0, Math.min(5, totalPages));
  const start = Math.max(1, Math.min(page - 2, totalPages - size + 1));
  return Array.from({ length: size }, (_, index) => start + index);
}
