import { decodeHTMLStrict } from "entities";
import { getG2bCommonCodeName } from "@/shared/lib/common-codes";
import {
  formatG2bDisplayNumber,
  formatG2bDisplayText,
  type G2bDisplayFormat,
} from "@/shared/lib/g2b-display-format";

/**
 * 계약요청 상세 화면의 표시 정의와 값 변환 로직.
 *
 * 기존 ContractRequestDetail.tsx의 로직을 그대로 분리한 파일이다.
 * 필드 순서, 중복 필드, 분기 우선순위, 빈값 처리 조건을 변경하지 않는다.
 */

// 섹션 순서와 각 섹션의 필드 순서를 원본 구현 그대로 유지한다.
// scope가 있는 섹션은 해당 업무구분에서만 표시한다.
const groups = [
  {
    title: "요청구분",
    fields: [
      ["prcmBsneAreaNm", "업무구분"],
      ["bizDtlItm01", "문서번호"],
      ["bizDtlItm45", "조달방식"],
      ["bizDtlItm02", "진행상태"],
      ["bizNo", "요청접수번호"],
      ["inptDt", "작성일자"],
    ],
  },
  {
    title: "실수요기관정보",
    fields: [
      ["dmstUntyGrpNm", "수요기관명"],
      ["bizDtlItm03", "담당부서명"],
      ["bizDtlItm04", "담당자"],
      ["bizDtlItm05", "전화번호"],
      ["bizDtlItm06", "팩스번호"],
    ],
  },
  {
    title: "요청기본정보",
    fields: [
      ["bizNm", "요청명"],
      ["bizDtlItm07", "영문요청명"],
      ["bizDtlItm08", "계약법구분"],
      ["ctrtTyCd", "계약구분"],
      ["bidCtrtMthdCd", "계약방법"],
      ["bizDtlItm09", "낙찰방법"],
      ["bizDtlItm10", "요청구분"],
      ["bizDtlItm11", "PQ심사대상여부"],
      ["bizDtlItm12", "적격심사대상여부"],
      ["bizDtlItm13", "적격심사대상여부"],
      ["bizDtlItm14", "장기계약차수"],
      ["fsyrCtrtNo", "초년도관리번호"],
    ],
  },
  {
    title: "요청정보",
    scope: "조070003",
    fields: [
      ["bizDtlItm15", "용역현장"],
      ["bizDtlItm16", "용역종류"],
      ["bizDtlItm17", "지역업체참여도 (지역가점)"],
      ["bizDtlItm1", "총공사금액(원)"],
      ["dmndSrchItm02", "총예산금액(원)"],
      ["dmndSrchItm02", "금차예산금액(원)"],
      ["dmndSrchItm03", "추정가격(원)"],
      ["bizDtlItm19", "총용역기간(일)"],
      ["bizDtlItm20", "금차용역기간(일)"],
      ["bizDtlItm22", "채권매입구분"],
      ["bizDtlItm23", "실적제한여부"],
      ["bizDtlItm21", "공동이행방식의 공동도급 적용여부"],
      ["bizDtlItm24", "맞춤형서비스 관리번호"],
      ["bizDtlItm25", "지역제한여부"],
      ["bizDtlItm26", "계약체결위임여부"],
    ],
  },
  {
    title: "요청기타정보",
    scope: "조070004",
    fields: [
      ["fildLgdngNm", "공사현장"],
      ["totlBgtAmt", "총공사예산금액(원)"],
      ["bgtAmt", "공사예정금액(원)"],
      ["cstrnConrAmt", "도급금액(원)"],
      ["cstrnGovcstGvspAmt", "관급자설치 관급금액(원)"],
      ["cstrnEtcAmt", "기타금액(원)"],
      ["cstrnConcstGvspAmt", "도급자설치 관급금액(원)"],
      ["cstrnPrtmConrAmt", "금차도급금액(원)"],
      ["cstrnTotlGvspAmt", "총관급금액(원)"],
      ["prspPrce", "추정가격(원)"],
      ["prtmBizNody", "금차공사기간"],
      ["totlBizNody", "총공사기간"],
    ],
  },
] as const;

// 일반 요청물품목록의 열 순서.
const itemFields = [
  ["rowNum", "No"],
  ["dtlsPrnmNo", "세부품명번호"],
  ["dtlsPrnm", "세부품명"],
  ["itemIdnfNo", "물품식별번호"],
  ["itemIdnfNm", "규격"],
  ["ctrtDmndQty", "수량"],
  ["ctrtDmndUprc", "단가(부가가치세포함)"],
  ["ctrtDmndAmt", "금액(부가가치세포함)"],
  ["dlvgdsTermNody", "납품일수/기한"],
  ["dlvgdsPlacNm", "납품장소"],
  ["devyCndtNm", "인도조건"],
  ["extlPbfnAsetDmndNoVal", "자산요청연번"],
  ["itrlPrcmAsetNoVal", "자체조달자산번호"],
] as const;

// 리스 요청물품목록의 열 순서.
const leaseItemFields = [
  ["rowNum", "No"],
  ["itemClsfNo", "물품분류번호"],
  ["itemIdnfNo", "물품식별번호"],
  ["itemIdnfNm", "품명"],
  ["itemCfnm", "규격"],
  ["spamAmt", "금액"],
  ["dlvgdsTermNody", "납품기한"],
] as const;

// 리스 요청금액 필드 순서.
const leaseAmountFields = [
  ["bizDtlItm31", "품대금액"],
  ["bizDtlItm32", "계약수수료"],
  ["bizDtlItm33", "리스수수료"],
  ["bizDtlItm34", "취득원가"],
  ["frcpYn", "내자외자구분"],
] as const;

// 외자 총액계약 요청금액 필드 순서.
const foreignTotalAmountFields = [
  ["bizDtlItm40", "총제조부기금액"],
  ["bizDtlItm41", "총납품기한"],
  ["bizDtlItm42", "총배정금액"],
  ["bizDtlItm37", "원화총배정금액"],
  ["bizDtlItm36", "환율"],
  ["bizDtlItm38", "총제경비"],
  ["bizDtlItm27", "예상조달수수료"],
  ["bizDtlItm43", "부가가치세율"],
  ["bizDtlItm44", "관세율"],
  ["dmndSrchItm03", "추정가격"],
] as const;

// 외자 단가계약 요청금액 필드 순서.
const foreignUnitAmountFields = [
  ["bizDtlItm35", "총배정금액"],
  ["bizDtlItm36", "환율"],
  ["bizDtlItm37", "원화총배정금액"],
  ["bizDtlItm38", "제경비"],
  ["dmndSrchItm03", "추정가격"],
  ["bizDtlItm39", "계약번호"],
] as const;

// 원래 필드 대신 표시명 필드를 우선 사용하는 기존 매핑.
const displayNames: Record<string, string> = {
  bizDtlItm45: "bizDtlItm46",
  ctrtTyCd: "ctrtTyNm",
  bidCtrtMthdCd: "bidCtrtMthdNm",
};

// 계약요청 화면에서 그룹이 확인된 필드만 변환한다.
// 계약구분(ctrtTyCd)은 원본 화면의 계12_PC036 그룹을 사용한다.
const commonCodeGroups: Readonly<Record<string, string>> = {
  bizDtlItm45: "조02_PR000",
  bizDtlItm02: "진01_PR003",
  bizDtlItm08: "계04_PC000",
  ctrtTyCd: "계12_PC036",
  bidCtrtMthdCd: "계03_PR019",
  bizDtlItm09: "낙03_PN000",
  bizDtlItm10: "신12_PR000",
};

// 상세·품목 API의 범용 키는 표시 라벨로 의미를 확인한 필드만 변환한다.
const fieldFormats: Readonly<Record<string, G2bDisplayFormat>> = {
  inptDt: "dateTime",
  bizDtlItm05: "phone",
  bizDtlItm06: "phone",
  bizDtlItm14: "integer",
  bizDtlItm17: "decimal",
  bizDtlItm1: "integer",
  dmndSrchItm02: "integer",
  dmndSrchItm03: "decimal",
  bizDtlItm19: "integer",
  bizDtlItm20: "integer",
  totlBgtAmt: "integer",
  bgtAmt: "integer",
  cstrnConrAmt: "integer",
  cstrnGovcstGvspAmt: "integer",
  cstrnEtcAmt: "integer",
  cstrnConcstGvspAmt: "integer",
  cstrnPrtmConrAmt: "integer",
  cstrnTotlGvspAmt: "integer",
  prspPrce: "integer",
  prtmBizNody: "integer",
  totlBizNody: "integer",
  ctrtDmndQty: "decimal",
  ctrtDmndUprc: "decimal",
  ctrtDmndAmt: "decimal",
  spamAmt: "decimal",
  bizDtlItm27: "decimal",
  bizDtlItm31: "decimal",
  bizDtlItm32: "decimal",
  bizDtlItm33: "decimal",
  bizDtlItm34: "decimal",
  bizDtlItm35: "decimal",
  bizDtlItm36: "decimal",
  bizDtlItm37: "integer",
  bizDtlItm38: "decimal",
  bizDtlItm40: "decimal",
  bizDtlItm41: "date",
  bizDtlItm42: "decimal",
  bizDtlItm43: "decimal",
  bizDtlItm44: "decimal",
};

/**
 * 요청 상세·품목의 값을 표시 형식으로 변환한다. 빈값과 대시 제외 규칙을 유지한다.
 * @param value API 원본 값.
 * @param key 지정하면 필드의 의미에 맞는 포맷을 적용한다.
 */
export function formatValue(value: unknown, key?: string) {
  if (typeof value !== "string" && typeof value !== "number") return;
  const decoded =
    typeof value === "string" ? decodeHTMLStrict(value) : String(value);
  if (!decoded.trim() || /^[-–—]+$/.test(decoded.trim())) return;

  if (key === "dlvgdsTermNody") {
    // 품목의 납품일수/기한은 일수 또는 일자 형태로 내려올 수 있다.
    const format =
      /^\d{4}[-/]?(?:0[1-9]|1[0-2])[-/]?(?:0[1-9]|[12]\d|3[01])$/.test(
        decoded.trim(),
      )
        ? "date"
        : "integer";
    return formatG2bDisplayText(decoded, format);
  }
  const format = key && fieldFormats[key];
  if (format) return formatG2bDisplayText(decoded, format);
  return typeof value === "number"
    ? formatG2bDisplayNumber(decoded, 3)
    : decoded;
}

/** 표시용 대체 키를 먼저 조회하고, 값이 없으면 원래 키를 사용한다. */
export function detailValue(detail: Record<string, unknown>, key: string) {
  const displayName = formatValue(detail[displayNames[key]]);
  if (displayName !== undefined) return displayName;
  const value = formatValue(detail[key], key);
  if (value === undefined) return undefined;
  const group = commonCodeGroups[key];
  return group ? getG2bCommonCodeName(group, value) : value;
}

/**
 * 섹션 및 요청물품정보 표시 여부를 기존 분기 순서대로 계산한다.
 * 원본 boxHide(3)의 순서: 물품·일반용역 → 리스 → 외자.
 */
export function getContractRequestDisplay(
  detail: Record<string, unknown>,
  items: readonly Record<string, unknown>[],
) {
  const scope = detail.prcmBsneAreaCd;
  const sections = groups.filter(
    (group) =>
      (!("scope" in group) || group.scope === scope) &&
      group.fields.some((field) => detailValue(detail, field[0]) !== undefined),
  );
  // 원본 boxHide(3)의 분기 순서에 따라 물품·일반용역을 리스와 외자보다 먼저 판별한다.
  const domestic = scope === "조070001" || scope === "조070002";
  const specialized = scope === "조070003" || scope === "조070004";
  const lease = !domestic && !specialized && detail.laseYn === "Y";
  const foreign = !domestic && !specialized && !lease && detail.frcpYn === "Y";
  const amountFields = lease
    ? leaseAmountFields
    : foreign && detail.ctrtTyCd === "계120001"
      ? foreignTotalAmountFields
      : foreign &&
          (detail.ctrtTyCd === "계120002" || detail.ctrtTyCd === "계120003")
        ? foreignUnitAmountFields
        : undefined;
  const showAmounts = amountFields?.some(
    (field) => detailValue(detail, field[0]) !== undefined,
  );
  const itemColumns: readonly (readonly [string, string])[] = lease
    ? leaseItemFields
    : itemFields;
  const columns = itemColumns.filter(([key]) =>
    items.some((item) => formatValue(item[key]) !== undefined),
  );
  const showItemList = (domestic || lease) && columns.length > 0;

  return { sections, amountFields, showAmounts, columns, showItemList };
}
