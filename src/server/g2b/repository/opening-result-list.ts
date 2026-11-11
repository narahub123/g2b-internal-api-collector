import type { DatabaseSync } from "node:sqlite";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { cleanText, openCollectionList, sortDate } from "./collection-list-query";

function listFields(raw: unknown, rawCode: unknown, rawLabel: unknown, linkedAgency: unknown) {
  const data = typeof raw === "string" ? JSON.parse(raw) : null;
  const business = resolveG2bBusiness(rawCode, rawLabel);
  const businesses = business ? [business] : [];
  const results = Array.isArray(data?.results) ? data.results : [];
  // 한 개찰차수에 분류별 결과가 여럿이면 가장 늦은 실제개찰일시를 사용한다.
  // 유찰 등 실제개찰일시가 없는 응답에 예정일시는 대입하지 않는다.
  let date: string | null = null;
  const agencies = new Set<string>();
  for (const result of results) {
    const actual = sortDate(result?.detail?.bidInfo?.realOnbsDt);
    if (actual && (date === null || actual > date)) date = actual;
    const agency = cleanText(result?.detail?.bidInfo?.dmstNm);
    if (agency) agencies.add(agency);
    if (!business) {
      const fallback = resolveG2bBusiness(result?.query?.businessCode, undefined);
      if (fallback) businesses.push(fallback);
    }
  }
  if (!agencies.size && cleanText(linkedAgency)) agencies.add(cleanText(linkedAgency));
  return JSON.stringify({ date, agencies: [...agencies], businesses });
}

/**
 * 개찰결과 원본에서 목록 조회용 필드를 추출하고 공통 페이지 조회에 연결한다.
 * @throws SQLite 함수 등록 또는 조회문 준비가 실패한 경우.
 */
export function openOpeningResultList(db: DatabaseSync, targets: string) {
  db.function("opening_result_list_fields", { deterministic: true }, listFields);
  return openCollectionList(db, "opening-results", targets,
    "opening_result_list_fields(saved.data, saved.businessCode, saved.businessLabel, saved.linkedAgency)",
  );
}
