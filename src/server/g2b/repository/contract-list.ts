import type { DatabaseSync } from "node:sqlite";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { cleanText, openCollectionList, sortDate } from "./collection-list-query";

function listFields(raw: unknown, rawCode: unknown, rawLabel: unknown) {
  const data = typeof raw === "string" ? JSON.parse(raw) : null;
  const business = resolveG2bBusiness(rawCode, rawLabel);
  const businesses = business ? [business] : [];
  const detail = data?.detail;
  return JSON.stringify({
    date: sortDate(detail?.frstCtrtDt),
    agencies: [cleanText(detail?.dmstUntyGrpNm)].filter(Boolean),
    receipt: cleanText(detail?.ctrtView),
    businesses,
  });
}

/**
 * 계약현황 원본에서 목록 조회용 필드를 추출하고 공통 페이지 조회에 연결한다.
 * @throws SQLite 함수 등록 또는 조회문 준비가 실패한 경우.
 */
export function openContractList(db: DatabaseSync, targets: string) {
  db.function("contract_list_fields", { deterministic: true }, listFields);
  return openCollectionList(db, "contracts", targets,
    "contract_list_fields(saved.data, saved.businessCode, saved.businessLabel)",
  );
}
