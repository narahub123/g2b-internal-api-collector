import { ADMIN_DICTIONARIES_PATH } from "../config/routes";

// 카드 표시와 전체 수집에 동일한 사전 순서를 사용한다.
export const dictionaries = [
  { id: "industry-law", title: "업종 및 근거법규", href: `${ADMIN_DICTIONARIES_PATH}/industry-law` },
  { id: "legal-districts", title: "법정동코드", href: `${ADMIN_DICTIONARIES_PATH}/legal-districts` },
] as const;

/** 설정에 등록된 사전만 조회와 수집 대상으로 사용한다. */
export type DictionaryId = (typeof dictionaries)[number]["id"];

/** 수집 결과를 사전별로 구분해 화면에 전달한다. */
export type DictionaryCollectionResult = {
  /** 실행을 시도한 사전. */
  id: DictionaryId;
  /** 저장 결과 또는 실행할 수 없었던 이유. */
  status: "created" | "updated" | "unchanged" | "busy" | "failed";
};
