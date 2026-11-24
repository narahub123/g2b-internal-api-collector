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
