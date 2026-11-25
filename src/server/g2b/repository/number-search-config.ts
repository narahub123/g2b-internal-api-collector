// 저장된 업무·출처 식별자는 배포 후 값이나 순서를 바꾸면 기존 조각과 호환되지 않는다.
export const numberSearchSections = {
  notices: { id: 1, table: "g2b_notice_list", number: "lower(@.number || @.revision)", receipt: null },
  "order-plans": { id: 2, table: "g2b_order_plan_list", number: "lower(@.number)", receipt: null },
  "prior-specs": { id: 3, table: "g2b_prior_spec_list", number: "lower(@.number || @.revision)", receipt: "json_extract(@.fields, '$.receipt')" },
  "opening-results": { id: 4, table: "g2b_opening_result_list", number: "lower(@.number || @.revision)", receipt: "json_extract(@.fields, '$.receipt')" },
  "contract-requests": { id: 5, table: "g2b_contract_request_list", number: "lower(@.number || @.revision)", receipt: "@.receipt" },
  contracts: { id: 6, table: "g2b_contract_list", number: "lower(@.number || @.revision)", receipt: "json_extract(@.fields, '$.receipt')" },
} as const;

// 목록 조회와 마이그레이션에서 사용할 수 있는 업무 이름을 제한한다.
export type NumberSearchSection = keyof typeof numberSearchSections;

// 이름 검색의 원본 표현식과 활성화할 트라이그램 출처를 함께 정의한다.
export const nameSearchSections: Partial<Record<NumberSearchSection, {
  // 제목 검색에 쓰는 기존 목록 값이다.
  title?: string;
  // 기관 검색에 쓰는 기존 단일 값 또는 JSON 배열이다.
  agency?: { expression: string; array: boolean };
  // 표시 조건을 통과한 세부품명 배열의 기존 검색 표현식이다.
  item?: string;
}>> = {
  notices: {
    title: "json_extract(@.fields, '$.searchTitle')",
    agency: { expression: "json_extract(@.fields, '$.agencies')", array: true },
  },
  "order-plans": { title: "@.sortTitle", agency: { expression: "@.agency", array: false } },
  "prior-specs": { title: "@.sortTitle", agency: { expression: "json_extract(@.fields, '$.agencies')", array: true } },
  "opening-results": { title: "@.sortTitle", agency: { expression: "json_extract(@.fields, '$.agencies')", array: true } },
    "contract-requests": {
    title: "@.sortTitle",
    agency: { expression: "@.agency", array: false },
    item: "json_extract(@.fields, '$.names')",
  },
  contracts: { title: "@.sortTitle", agency: { expression: "json_extract(@.fields, '$.agencies')", array: true } },
};
