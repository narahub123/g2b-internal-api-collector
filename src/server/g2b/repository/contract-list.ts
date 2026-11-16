import type { G2bDatabase } from "./database";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { cleanText, openCollectionList, sortDate } from "./collection-list-query";

/** 수집 원본에서 목록 검색과 정렬에 필요한 파생값을 계산한다. */
export function contractFields(raw: unknown, rawCode: unknown, rawLabel: unknown) {
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
 * @throws Turso에서 목록 조회에 실패한 경우.
 */
export function openContractList(db: G2bDatabase, targets: string) {
  return openCollectionList(db, "contracts", targets,
    "json_extract(saved.query_data, '$.fields')",
  );
}
