import type { G2bDatabase } from "./database";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { cleanText, openCollectionList, sortDate } from "./collection-list-query";

/** 수집 원본에서 목록 검색과 정렬에 필요한 파생값을 계산한다. */
export function openingResultFields(raw: unknown) {
  const data = typeof raw === "string" ? JSON.parse(raw) : null;
  const businesses: NonNullable<ReturnType<typeof resolveG2bBusiness>>[] = [];
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
    const business = resolveG2bBusiness(result?.query?.businessCode, undefined);
    if (business) businesses.push(business);
  }
  return JSON.stringify({ date, agencies: [...agencies], businesses });
}

/**
 * 개찰결과 원본에서 목록 조회용 필드를 추출하고 공통 페이지 조회에 연결한다.
 * @throws Turso에서 목록 조회에 실패한 경우.
 */
export function openOpeningResultList(db: G2bDatabase, targets: string) {
  return openCollectionList(db, "opening-results", targets,
    `CASE WHEN saved.query_data IS NULL THEN NULL ELSE json_set(
      json_extract(saved.query_data, '$.fields'),
      '$.businesses', json(COALESCE(
        CASE WHEN saved.linkedCode IS NULL THEN json_extract(saved.query_data, '$.singleBusiness') END,
        saved.linkedBusiness,
        json_extract(saved.query_data, '$.fields.businesses')
      )),
      '$.agencies', CASE WHEN json_array_length(saved.query_data, '$.fields.agencies') = 0 AND COALESCE(saved.linkedAgency, '') <> ''
        THEN json_array(saved.linkedAgency) ELSE json_extract(saved.query_data, '$.fields.agencies') END
    ) END`,
  );
}
