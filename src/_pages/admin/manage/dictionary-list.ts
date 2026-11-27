import type { ListFilter, ListFilterValues, ListOption } from "@/shared/ui/list-controls/model";
import type { DictionaryId } from "./dictionaries";

/** 주소에서 읽는 검색 및 페이지 조건이다. */
export type DictionarySearchParams = Record<string, string | string[] | undefined>;
/** 공통 표가 표시할 저장 행의 문자열 필드다. */
type DictionaryRow = Record<string, string>;

// 저장된 원본 필드 순서를 표 머리글 및 검색 대상에 연결한다.
export const dictionaryLists = {
  "industry-law": {
    fields: [{ value: "industryCode", label: "업종코드" }, { value: "industryName", label: "업종명" }],
    columns: [
      ["categoryCode", "업종분류코드"], ["categoryName", "업종분류명"], ["industryCode", "업종코드"],
      ["industryName", "업종명"], ["legalBasis", "근거법령"], ["relatedRules", "관련규정내용"],
      ["active", "사용 여부"], ["restrictedCode", "제한업종코드"], ["restrictedName", "제한업종명"],
      ["allowedCode", "허용업종코드"], ["allowedName", "허용업종명"],
    ],
  },
  "legal-districts": {
    fields: [{ value: "code", label: "법정동코드" }, { value: "name", label: "법정동명" }],
    columns: [["code", "법정동코드"], ["name", "법정동명"], ["status", "폐지여부"]],
  },
} as const;

// 목록마다 같은 수의 행을 서버에서 선택한다.
const pageSize = 50;

/**
 * 분류 선택지와 상태 필터를 실제 저장 행에 맞게 구성한다.
 * @param id 사전 식별자.
 * @param rows 원본 순서의 전체 저장 행.
 * @returns 공용 목록 UI에 전달할 다중 선택 필터.
 */
function getFilters(id: DictionaryId, rows: readonly DictionaryRow[]): ListFilter[] {
  if (id === "legal-districts") return [{ id: "status", label: "폐지 여부", type: "multi-select",
    options: [{ value: "존재", label: "존재" }, { value: "폐지", label: "폐지" }] }];

  // 검색 결과에 관계없이 전체 목록에서 첫 분류명을 코드별로 보존한다.
  const categories = new Map<string, ListOption>();
  for (const { categoryCode, categoryName } of rows) {
    if (categoryCode && !categories.has(categoryCode)) {
      categories.set(categoryCode, { value: categoryCode, label: categoryName ? `${categoryName} (${categoryCode})` : categoryCode });
    }
  }
  return [
    { id: "categoryCode", label: "업종구분", type: "multi-select", options: [...categories.values()] },
    { id: "active", label: "사용 여부", type: "multi-select", options: [{ value: "Y", label: "사용(Y)" }, { value: "N", label: "미사용(N)" }] },
  ];
}

/**
 * 저장 행에 URL 조건을 적용하고 현재 페이지에 필요한 데이터만 선택한다.
 * @param id 컬럼과 조건을 선택할 사전 식별자.
 * @param rows 수집한 저장 목록.
 * @param params 검색 대상·검색어·필터·페이지를 담은 주소 조건.
 * @returns 정규화한 조건, 선택지, 결과 페이지 및 결과 건수.
 */
export function dictionaryPage(id: DictionaryId, rows: readonly DictionaryRow[], params: DictionarySearchParams) {
  // 등록된 검색 대상만 허용하고 코드는 문자열로 유지한다.
  const { fields } = dictionaryLists[id];
  const field = fields.find((choice) => choice.value === params.field)?.value ?? fields[0].value;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const filters = getFilters(id, rows);
  const values: ListFilterValues = {};
  const selected = new Map<string, Set<string>>();
  for (const filter of filters) {
    if (filter.type !== "multi-select") continue;
    // URL의 반복 값 중 현재 사전에 유효한 선택만 사용한다.
    const raw = params[filter.id];
    const requested = new Set(Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]);
    const valid = filter.options.filter(({ value }) => requested.has(value)).map(({ value }) => value);
    if (valid.length) {
      values[filter.id] = valid;
      selected.set(filter.id, new Set(valid));
    }
  }
  // 같은 필터에서는 하나라도 일치하면 되고 서로 다른 필터는 모두 적용한다.
  const matches = rows.filter((row) => {
    if (query && !row[field].includes(query)) return false;
    for (const [key, choices] of selected) {
      if (!choices.has(row[key])) return false;
    }
    return true;
  });
  // 1부터 시작하는 페이지를 결과 범위 안으로 보정한다.
  const requestedPage = typeof params.page === "string" && /^[0-9]+$/.test(params.page) ? Number(params.page) : 1;
  const totalPages = Math.ceil(matches.length / pageSize);
  const page = Math.max(1, Math.min(requestedPage, totalPages));
  return { fields, search: { field, query }, filters, values, page, totalPages, total: matches.length,
    rows: matches.slice((page - 1) * pageSize, page * pageSize) };
}
