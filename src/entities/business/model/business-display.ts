import type { BusinessApi, BusinessItem } from "./business-apis";
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

/** 화면에 표시할 필드의 응답 키와 라벨 정의. */
type Field = readonly [key: string, label: string];

/** 업무별 화면 표시 필드와 기본 표시 순서를 정의한다. */
const displayFields: Record<BusinessApi, readonly Field[]> = {
  // 조달업체 기본정보
  basic: [
    ["bizno", "사업자등록번호"],
    ["esntlNoCertRgstYn", "고유번호증명등록여부"],
    ["hdoffceDivNm", "본사구분명"],
    ["ceoNm", "대표자명"],
    ["corpNm", "업체명"],
    ["engCorpNm", "영문업체명"],
    ["opbizDt", "개업일시"],
    ["rgstDt", "등록일시"],
    ["chgDt", "변경일시"],
    ["cntryNm", "국가명"],
    ["rgnCd", "지역코드"],
    ["rgnNm", "지역명"],
    ["zip", "우편번호"],
    ["adrs", "주소"],
    ["dtlAdrs", "상세주소"],
    ["telNo", "전화번호"],
    ["faxNo", "팩스번호"],
    ["hmpgAdrs", "홈페이지주소"],
    ["mnfctDivCd", "제조구분코드"],
    ["mnfctDivNm", "제조구분명"],
    ["emplyeNum", "종업원수"],
    ["corpBsnsDivCd", "업체업무구분코드"],
    ["corpBsnsDivNm", "업체업무구분명"],
  ],

  // 조달업체 업종정보
  industry: [
    ["bizno", "사업자등록번호"],
    ["indstrytyNm", "업종명"],
    ["indstrytyCd", "업종코드"],
    ["rgstDt", "등록일시"],
    ["vldPrdExprtDt", "유효기간만료일시"],
    ["systmRgstDt", "시스템등록일시"],
    ["chgDt", "변경일시"],
    ["indstrytyStatsNm", "업종상태명"],
    ["rprsntIndstrytyYn", "대표업종여부"],
    ["systmChgDt", "시스템변경일시"],
  ],

  // 조달업체 공급물품정보
  product: [
    ["bizno", "사업자등록번호"],
    ["dtilPrdctClsfcNoNm", "세부품명"],
    ["dtilPrdctClsfcNo", "세부품명번호"],
    ["rgstDt", "등록일시"],
    ["chgDt", "변경일시"],
    ["rprsntPrdctClsfcNoNmYn", "대표품명여부"],
    ["mnfctYn", "제조여부"],
  ],

  // 부정당제재업체정보
  sanction: [
    ["bizno", "사업자등록번호"],
    ["corpNm", "업체명"],
    ["unptRsttDocNm", "제재문서명"],
    ["rsttBgnDate", "제재시작일자"],
    ["rsttEndDate", "제재종료일자"],
    ["insttCd", "수요기관코드"],
    ["insttNm", "수요기관명"],
    ["lawordNm", "근거법령명"],
    ["lawordArtclClause", "조항호"],
    ["lawordArtclClauseCd", "조항호코드"],
    ["lawordArtclClauseCdNm", "조항호코드명"],
    ["enfcAtcsCd", "시행규칙코드"],
    ["enfcPrvNm", "시행규칙코드명"],
    ["ntfcnDt", "게재일시"],
    ["rsttPrdMonthNum", "제재기간개월수"],
    ["rsttPrdDayNum", "제재기간일수"],
    ["rsttProgrsNm", "제재상태명"],
  ],

  // 직접생산확인증명
  directProduction: [
    ["certSeCode", "확인서구분코드"],
    ["validPdBeginDe", "유효기간시작일"],
    ["validPdEndDe", "유효기간만료일"],
    ["certfcDe", "인증일"],
    ["detailPrdnmNo", "세부품명번호"],
    ["essntlPartclrMatter", "필수특이사항"],
  ],

  // 여성기업확인
  women: [
    ["certSeCode", "확인서구분코드"],
    ["issuInstt", "인증기관"],
    ["validPdBeginDe", "유효기간시작일"],
    ["validPdEndDe", "유효기간만료일"],
    ["certfcDe", "인증일"],
  ],

  // 장애인기업확인
  disabled: [
    ["certSeCode", "확인서구분코드"],
    ["issuInstt", "인증기관"],
    ["validPdBeginDe", "유효기간시작일"],
    ["validPdEndDe", "유효기간만료일"],
    ["certfcDe", "인증일"],
  ],
};

/** 화면 배치의 기준이 되는 전체 Grid 열 개수이다. */
const GRID_COLUMNS = 12;

/** 화면 배치에서 직접 지정할 수 있는 Grid 열 개수이다. */
type FieldWidth = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** 화면 배치 항목이며 span은 기본 열 개수, width는 12칸 기준의 직접 지정 너비이다. */
type FieldOrderItem =
  | string
  | null
  | {
      field: string;
      span?: 1 | 2 | 3;
      width?: FieldWidth;
    };

/** 업무별 화면 배치 순서이며 null은 화면 배치 전용 빈칸이다. */
type FieldOrder = Partial<Record<BusinessApi, readonly FieldOrderItem[]>>;

/** 업무별 1열 화면의 표시 순서를 정의한다. */
const displayFieldOrder1: FieldOrder = {
  // 조달업체 기본정보
  basic: [
    // "bizno",
    "ceoNm",
    "corpNm",
    "engCorpNm",
    "hdoffceDivNm",
    "emplyeNum",
    "esntlNoCertRgstYn",
    "opbizDt",
    "rgstDt",
    "chgDt",
    "cntryNm",
    "rgnCd",
    "rgnNm",
    "zip",
    "adrs",
    "dtlAdrs",
    "telNo",
    "faxNo",
    "hmpgAdrs",
    "mnfctDivCd",
    "mnfctDivNm",
    "corpBsnsDivCd",
    "corpBsnsDivNm",
  ],

  // 조달업체 업종정보
  industry: [
    // "bizno",
    "indstrytyNm",
    "indstrytyCd",
    "indstrytyStatsNm",
    "rprsntIndstrytyYn",
    "rgstDt",
    "vldPrdExprtDt",
    "chgDt",
    "systmRgstDt",
    "systmChgDt",
  ],

  // 조달업체 공급물품정보
  product: [
    // "bizno",
    "dtilPrdctClsfcNoNm",
    "dtilPrdctClsfcNo",
    "rprsntPrdctClsfcNoNmYn",
    "mnfctYn",
    "rgstDt",
    "chgDt",
  ],

  // 부정당제재업체정보
  sanction: [
    // "bizno",
    // "corpNm",
    "unptRsttDocNm",
    "rsttProgrsNm",
    "insttCd",
    "insttNm",
    "ntfcnDt",
    "rsttBgnDate",
    "rsttEndDate",
    "rsttPrdMonthNum",
    "lawordNm",
    "lawordArtclClause",
    "lawordArtclClauseCd",
    "lawordArtclClauseCdNm",
    "enfcAtcsCd",
    "enfcPrvNm",
    // "rsttPrdDayNum",
  ],

  // 직접생산확인증명
  directProduction: [
    // "certSeCode",
    "detailPrdnmNo",
    "certfcDe",
    "validPdBeginDe",
    "validPdEndDe",
    "essntlPartclrMatter",
  ],

  // 여성기업확인
  women: [
    // "certSeCode",
    "issuInstt",
    "certfcDe",
    "validPdBeginDe",
    "validPdEndDe",
  ],

  // 장애인기업확인
  disabled: [
    // "certSeCode",
    "issuInstt",
    "certfcDe",
    "validPdBeginDe",
    "validPdEndDe",
  ],
};

/** 업무별 2열 화면의 표시 순서를 정의한다. */
const displayFieldOrder2: FieldOrder = {
  // 조달업체 기본정보
  basic: [
    // "bizno",
    "ceoNm",
    "esntlNoCertRgstYn",
    "corpNm",
    "engCorpNm",
    "hdoffceDivNm",
    "emplyeNum",
    {field: "opbizDt", width: 4},
    {field: "rgstDt", width: 4},
    {field: "chgDt", width: 4},
    "cntryNm",
    null,
    "rgnCd",
    "rgnNm",
    "zip",
    null,
    "adrs",
    "dtlAdrs",
    "telNo",
    "faxNo",
    {field: "hmpgAdrs", width: 12},
    "mnfctDivCd",
    "mnfctDivNm",
    "corpBsnsDivCd",
    "corpBsnsDivNm",
  ],

  // 조달업체 업종정보
  industry: [
    // "bizno",
    "indstrytyNm",
    "indstrytyCd",
    "indstrytyStatsNm",
    "rprsntIndstrytyYn",
    {field: "rgstDt", width: 4},
    {field: "vldPrdExprtDt", width: 4},
    {field: "chgDt", width: 4},
    "systmRgstDt",
    "systmChgDt",
  ],

  // 조달업체 공급물품정보
  product: [
    // "bizno",
    "dtilPrdctClsfcNoNm",
    "dtilPrdctClsfcNo",
    "rprsntPrdctClsfcNoNmYn",
    "mnfctYn",
    "rgstDt",
    "chgDt",
  ],

  // 부정당제재업체정보
  sanction: [
    // "bizno",
    // "corpNm",
    "unptRsttDocNm",
    "rsttProgrsNm",
    "insttCd",
    "insttNm",
    "ntfcnDt",
    null,
    "rsttBgnDate",
    "rsttEndDate",
    "rsttPrdMonthNum",
    null,
    "lawordNm",
    null,
    "lawordArtclClause",
    "lawordArtclClauseCd",
    { field: "lawordArtclClauseCdNm", span: 2 },
    "enfcAtcsCd",
    { field: "enfcPrvNm", span: 2 },
    // "rsttPrdDayNum",
  ],

  // 직접생산확인증명
  directProduction: [
    // "certSeCode",
    {field: "detailPrdnmNo", width: 3},
    {field: "certfcDe", width: 3},
    {field: "validPdBeginDe", width: 3},
    {field: "validPdEndDe", width: 3},
    "essntlPartclrMatter",
  ],

  // 여성기업확인
  women: [
    // "certSeCode",
    "issuInstt",
    "certfcDe",
    "validPdBeginDe",
    "validPdEndDe",
  ],

  // 장애인기업확인
  disabled: [
    // "certSeCode",
    "issuInstt",
    "certfcDe",
    "validPdBeginDe",
    "validPdEndDe",
  ],
};

/** 업무별 3열 화면의 표시 순서를 정의한다. */
const displayFieldOrder3: FieldOrder = {
  // 조달업체 기본정보
  basic: [
    // "bizno",
    "ceoNm",
    "corpNm",
    "engCorpNm",
    "hdoffceDivNm",
    "emplyeNum",
    "esntlNoCertRgstYn",
    "opbizDt",
    "rgstDt",
    "chgDt",
    "cntryNm",
    "rgnCd",
    "rgnNm",
    "zip",
    "adrs",
    "dtlAdrs",
    "telNo",
    "faxNo",
    "hmpgAdrs",
    "mnfctDivCd",
    "mnfctDivNm",
    null,
    "corpBsnsDivCd",
    "corpBsnsDivNm",
  ],

  // 조달업체 업종정보
  industry: [
    // "bizno",
    {field: "indstrytyNm", width: 3},
    {field: "indstrytyCd", width: 3},
    {field: "indstrytyStatsNm", width: 3},
    {field: "rprsntIndstrytyYn", width: 3},
    "rgstDt",
    "vldPrdExprtDt",
    "chgDt",
    "systmRgstDt",
    "systmChgDt",
  ],

  // 조달업체 공급물품정보
  product: [
    // "bizno",
    {field: "dtilPrdctClsfcNoNm", width: 3},
    {field: "dtilPrdctClsfcNo", width: 3},
    {field: "rprsntPrdctClsfcNoNmYn", width: 3},
    {field: "mnfctYn", width: 3},
    "rgstDt",
    "chgDt",
  ],

  // 부정당제재업체정보
  sanction: [
    // "bizno",
    // "corpNm",
    "unptRsttDocNm",
    "insttCd",
    "insttNm",
    "rsttProgrsNm",
    "ntfcnDt",
    null,
    "rsttBgnDate",
    "rsttEndDate",
    "rsttPrdMonthNum",
    "lawordNm",
    null,
    null,
    "lawordArtclClause",
    "lawordArtclClauseCd",
    { field: "lawordArtclClauseCdNm", span: 3 },
    "enfcAtcsCd",
    { field: "enfcPrvNm", span: 2 },

    // "rsttPrdDayNum",
  ],

  // 직접생산확인증명
  directProduction: [
    // "certSeCode",
    {field: "detailPrdnmNo", width: 3},
    {field: "certfcDe", width: 3},
    {field: "validPdBeginDe", width: 3},
    {field: "validPdEndDe", width: 3},
    "essntlPartclrMatter",
  ],

  // 여성기업확인
  women: [
    // "certSeCode",
    {field: "issuInstt", width: 3},
    {field: "certfcDe", width: 3},
    {field: "validPdBeginDe", width: 3},
    {field: "validPdEndDe", width: 3},
  ],

  // 장애인기업확인
  disabled: [
    // "certSeCode",
    {field: "issuInstt", width: 3},
    {field: "certfcDe", width: 3},
    {field: "validPdBeginDe", width: 3},
    {field: "validPdEndDe", width: 3},
  ],
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
 * 화면 배치 순서에서 실제 필드의 위치를 반환한다.
 * @param field 응답 필드 키.
 * @param index 기본 표시 순서.
 * @param fieldOrder 화면 배치 순서.
 * @returns 해당 화면에서의 표시 순서. 미표시 필드는 -1.
 */
function resolveFieldOrder(
  field: string,
  index: number,
  fieldOrder?: readonly FieldOrderItem[],
) {
  // 별도 순서가 정의되지 않은 업무는 기본 순서를 사용한다.
  if (!fieldOrder) return index;

  // 배치 순서에 없는 필드는 표시하지 않는다.
  return fieldOrder.findIndex((item) =>
    typeof item === "string" ? item === field : item?.field === field,
  );
}

/**
 * 화면 배치 항목에서 실제 필드가 차지할 Grid 열의 개수를 반환한다.
 * @param field 응답 필드 키.
 * @param columns 화면의 기본 열 개수.
 * @param fieldOrder 화면 배치 순서.
 * @returns 12칸 기준으로 필드가 차지할 열의 개수.
 */
function resolveFieldSpan(
  field: string,
  columns: number,
  fieldOrder?: readonly FieldOrderItem[],
) {
  // 별도 너비가 정의되지 않은 필드는 기본 열 너비를 사용한다.
  const defaultSpan = GRID_COLUMNS / columns;
  const item = fieldOrder?.find(
    (item) => item !== null && typeof item === "object" && item.field === field,
  );

  if (!item || typeof item !== "object") return defaultSpan;

  // 직접 지정한 너비가 있으면 기본 열 병합보다 우선 적용한다.
  if (item.width !== undefined) return item.width;

  // 기존 열 병합 설정을 12칸 기준으로 변환한다.
  return Math.min(item.span ?? 1, columns) * defaultSpan;
}

/**
 * 업무 필드를 화면 표시 순서에 맞춰 읽기 전용 화면 데이터로 바꾼다.
 * @param kind 업무 API의 종류.
 * @param item 저장된 업무 항목.
 * @returns 화면 표시 순서의 라벨과 표시값 및 반응형 표시 순서와 열 개수.
 */
export function businessDisplayFields(kind: BusinessApi, item: BusinessItem) {
  // 업무별 1열, 2열 및 3열 표시 순서를 선택한다.
  const fieldOrder1 = displayFieldOrder1[kind];
  const fieldOrder2 = displayFieldOrder2[kind];
  const fieldOrder3 = displayFieldOrder3[kind];

  // 업무별 표시 순서를 적용하며 빈 필드에도 목록과 구별되는 자리표시를 사용한다.
  return displayFields[kind].map(([field, label], index) => {
    // 문자열 값만 전화번호 또는 등록번호 정책에 따라 화면에서 변환한다.
    const value = item[field];
    const text = value == null ? "" : String(value);
    const display =
      field === "bizno"
        ? formatBusinessNumber(text)
        : field === "telNo" || field === "faxNo"
          ? formatG2bPhone(text)
          : text;

    // 화면 크기별 표시 순서를 결정한다.
    const order1 = resolveFieldOrder(field, index, fieldOrder1);
    const order2 = resolveFieldOrder(field, index, fieldOrder2);
    const order3 = resolveFieldOrder(field, index, fieldOrder3);

    // 화면 크기별 필드가 차지할 Grid 열의 개수를 결정한다.
    const span2 = resolveFieldSpan(field, 2, fieldOrder2);
    const span3 = resolveFieldSpan(field, 3, fieldOrder3);

    // 표시 과정에서 빈값이 된 경우에도 필드 라벨은 유지한다.
    return {
      field,
      label,
      value: display?.trim() ? display : "—",
      order1,
      order2,
      order3,
      span2,
      span3,
    };
  });
}

/**
 * 업무별 화면 배치 전용 빈칸의 위치를 반환한다.
 * @param kind 업무 API의 종류.
 * @returns 2열 및 3열 화면에서 빈칸을 표시할 위치.
 */
export function businessDisplayEmptySlots(kind: BusinessApi) {
  // 실제 데이터와 별개로 화면 배치 배열의 null 위치만 추출한다.
  const getEmptySlots = (fieldOrder?: readonly FieldOrderItem[]) =>
    (fieldOrder ?? []).flatMap((field, index) =>
      field === null ? [index] : [],
    );

  return {
    columns2: getEmptySlots(displayFieldOrder2[kind]),
    columns3: getEmptySlots(displayFieldOrder3[kind]),
  };
}
