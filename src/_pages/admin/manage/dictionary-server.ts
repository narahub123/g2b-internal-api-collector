import { getIndustryLawMetadata, getIndustryLawRows } from "@/server/collections/industry-law";
import { cache } from "react";
import { getLegalDistrictMetadata, getLegalDistrictRows } from "@/server/collections/legal-districts";
import { dictionaries, type DictionaryId } from "./dictionaries";

// 관리 화면의 사전 정의를 기존 서버 조회 함수에 연결한다.
export const dictionaryServer = {
  "industry-law": { metadata: getIndustryLawMetadata, rows: getIndustryLawRows },
  "legal-districts": { metadata: getLegalDistrictMetadata, rows: getLegalDistrictRows },
};

/**
 * 사전별 메타데이터를 개별적으로 읽어 정상 카드가 다른 카드의 장애에 영향을 받지 않게 한다.
 * @param fresh 원격 워커 완료로 최신 적용본을 읽을 사전 목록.
 * @returns 카드와 해당 사전의 조회 상태, 건수 및 보조 표시값.
 */
export const getDictionaryCards = cache(async function getDictionaryCards(fresh: readonly DictionaryId[] = []) {
  return Promise.all(dictionaries.map((definition) => readCard(definition, fresh.includes(definition.id))));
});

/**
 * 사전 하나의 카드에 필요한 메타데이터만 읽는다.
 * @param definition 표시할 사전 정의.
 * @param fresh 원격 실행 완료 후 표시 캐시를 갱신할지 여부.
 * @returns 정상, 미수집 또는 조회 실패 카드.
 */
async function readCard(definition: (typeof dictionaries)[number], fresh: boolean) {
  try {
    // 각 사전의 날짜 의미와 집계 명칭을 유지한다.
    const details = definition.id === "industry-law" ? await industryDetails(fresh) : await districtDetails(fresh);
    return { ...definition, details, failed: false };
  } catch (error) {
    // 내부 파일 경로는 서버 로그에만 남긴다.
    console.error("[사전 메타데이터]", definition.id, error);
    return { ...definition, details: undefined, failed: true };
  }
}

/**
 * 업종 보고서 집계와 원본 수정 시각을 카드 표시값으로 변환한다.
 * @param fresh 최신 적용본을 직접 읽을지 여부.
 * @returns 업종 카드에 표시할 집계.
 */
async function industryDetails(fresh: boolean) {
  const data = await dictionaryServer["industry-law"].metadata({ freshMetadata: fresh });
  return data && { total: data.totalRows, fields: [
    { label: "고유 업종코드", value: formatCount(data.codes) },
    { label: "원본 최근 수정 시각", value: data.lastUpdate.replace(/^최근 수정:\s*/, "") },
  ] };
}

/**
 * 법정동의 상태별 건수와 날짜를 카드 표시값으로 변환한다.
 * @param fresh 최신 적용본을 직접 읽을지 여부.
 * @returns 법정동 카드에 표시할 집계.
 */
async function districtDetails(fresh: boolean) {
  const data = await dictionaryServer["legal-districts"].metadata({ freshMetadata: fresh });
  return data && { total: data.total, fields: [
    { label: "존재", value: formatCount(data.active) },
    { label: "폐지", value: formatCount(data.abolished) },
    { label: "마지막 수집 확인일", value: data.lastSuccessfulDate },
  ] };
}

/**
 * 카드와 상세에서 한국어 건수 표시를 일관되게 만든다.
 * @param count 집계된 행 수.
 * @returns 천 단위 구분을 포함한 건수.
 */
export function formatCount(count: number) {
  return count.toLocaleString("ko-KR") + "건";
}

/**
 * 요청에서 받은 값이 등록된 사전인지 확인한다.
 * @param value 신뢰할 수 없는 요청값.
 * @returns 유효한 사전 식별자인지 여부.
 */
export function isDictionaryId(value: unknown): value is DictionaryId {
  return dictionaries.some(({ id }) => id === value);
}
