import { BUSINESS_APIS, type BusinessApi, type BusinessItem } from "./business-apis";
import { formatG2bPhone } from "@/shared/lib/g2b-phone";

/** 업무 응답 문서의 정보 종류별 화면 제목이다. */
export const businessSectionTitles: Record<BusinessApi, string> = {
  basic: "기본정보",
  industry: "업종정보",
  product: "공급물품정보",
  sanction: "부정당제재업체정보",
  directProduction: "직접생산확인증명",
  women: "여성기업확인",
  disabled: "장애인기업확인",
};

/** 명세에 정의된 각 업무 필드에 대응하는 표시 라벨이다. */
const labels: Record<string, string> = {
  bizno: "사업자등록번호",
  corpNm: "업체명",
  unptRsttDocNm: "제재문서명",
  rsttBgnDate: "제재시작일자",
  rsttEndDate: "제재종료일자",
  insttCd: "수요기관코드",
  insttNm: "수요기관명",
  lawordNm: "근거법령명",
  lawordArtclClause: "조항호",
  lawordArtclClauseCd: "조항호코드",
  lawordArtclClauseCdNm: "조항호코드명",
  enfcAtcsCd: "시행규칙코드",
  enfcPrvNm: "시행규칙코드명",
  ntfcnDt: "게재일시",
  rsttPrdMonthNum: "제재기간개월수",
  rsttPrdDayNum: "제재기간일수",
  rsttProgrsNm: "제재상태명",
  dtilPrdctClsfcNoNm: "세부품명",
  dtilPrdctClsfcNo: "세부품명번호",
  rgstDt: "등록일시",
  chgDt: "변경일시",
  rprsntPrdctClsfcNoNmYn: "대표품명여부",
  mnfctYn: "제조여부",
  engCorpNm: "영문업체명",
  opbizDt: "개업일시",
  rgnCd: "지역코드",
  rgnNm: "지역명",
  zip: "우편번호",
  adrs: "주소",
  dtlAdrs: "상세주소",
  telNo: "전화번호",
  faxNo: "팩스번호",
  cntryNm: "국가명",
  hmpgAdrs: "홈페이지주소",
  mnfctDivCd: "제조구분코드",
  mnfctDivNm: "제조구분명",
  emplyeNum: "종업원수",
  corpBsnsDivCd: "업체업무구분코드",
  corpBsnsDivNm: "업체업무구분명",
  hdoffceDivNm: "본사구분명",
  esntlNoCertRgstYn: "고유번호증명등록여부",
  ceoNm: "대표자명",
  indstrytyNm: "업종명",
  indstrytyCd: "업종코드",
  vldPrdExprtDt: "유효기간만료일시",
  systmRgstDt: "시스템등록일시",
  indstrytyStatsNm: "업종상태명",
  rprsntIndstrytyYn: "대표업종여부",
  systmChgDt: "시스템변경일시",
  certSeCode: "확인서구분코드",
  issuInstt: "인증기관",
  validPdBeginDe: "유효기간시작일",
  validPdEndDe: "유효기간만료일",
  certfcDe: "인증일",
  detailPrdnmNo: "세부품명번호",
  essntlPartclrMatter: "필수특이사항",
};

/**
 * 10자리 사업자등록번호를 목록과 상세에서 읽기 쉬운 표기로 표시한다.
 * @param number 원본 번호.
 * @returns 3-2-5 표기 또는 기존에 표시할 수 없는 값의 원본.
 */
export function formatBusinessNumber(number: string) {
  // 저장값은 그대로 두고 화면에서만 구분자를 추가한다.
  return number.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3");
}

/**
 * 업무 필드를 명세의 순서에 맞춰 읽기 전용 화면 데이터로 바꾼다.
 * @param kind 업무 API의 종류.
 * @param item 저장된 업무 항목.
 * @returns 원본 순서의 라벨과 표시값.
 */
export function businessDisplayFields(kind: BusinessApi, item: BusinessItem) {
  // 문서 순서대로 표시하며 빈 필드에도 목록과 구별되는 자리표시를 사용한다.
  return BUSINESS_APIS[kind].fields.map((field) => {
    // 문자열 값만 전화번호 또는 등록번호 정책에 따라 화면에서 변환한다.
    const value = item[field];
    const text = value == null ? "" : String(value);
    const display = field === "bizno" ? formatBusinessNumber(text) :
      field === "telNo" || field === "faxNo" ? formatG2bPhone(text) : text;
    // 표시 과정에서 빈값이 된 경우에도 필드 라벨은 유지한다.
    return { field, label: labels[field], value: display?.trim() ? display : "—" };
  });
}
