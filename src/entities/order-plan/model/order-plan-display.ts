import { decodeHTMLStrict } from "entities";
import {
  formatG2bDisplayDate,
  formatG2bDisplayDateTime,
  formatG2bDisplayNumber,
} from "@/shared/lib/g2b/g2b-display-format";
import { formatG2bPhone } from "@/shared/lib/g2b-phone";
import type { OrderPlan } from "./order-plan";

/** 화면에 표시할 필드의 응답 키, 라벨, 값 형식 및 앞뒤 단위 정의. */
type Field = readonly [
  key: string,
  label: string,
  format?: "integer" | "decimal" | "month" | "dateTime" | "phone",
  prefix?: string,
  suffix?: string,
];

/** 모든 지원 업무구분의 기본정보에 공통으로 표시할 필드. */
const commonFields = [
  ["prcmBsneSeCdNm", "업무구분"],
  ["oderPlanNo", "발주계획번호"],
  ["releaseDt", "공개일시", "dateTime"],
  ["oderInstNm", "발주기관"],
  ["oderYymm", "발주시기", "month"],
  ["prcmMthoSeCdNm", "조달방식"],
] as const satisfies readonly Field[];

/** 물품·리스 및 용역 기본정보에 추가할 계약 관련 필드. */
const goodsAndServiceFields = [
  ["stdCtrtMthdCdNm", "계약방법"],
  ["intbidTrgtYnNm", "국제입찰대상 여부"],
  ["agrtSeCdNm", "협정여부"],
] as const satisfies readonly Field[];

/** 자체물품분류번호를 표시할 수 있는 기관의 통합그룹번호 집합. */
const ownGoodsInstitutions = new Set([
  "IN0100000059188",
  "IN0100000029951",
  "IN0100000062735",
  "IN0100000031685",
  "IN0100000014181",
]);

/** 물품·리스와 외자 구매계획에 사용할 수량·금액 필드. */
const purchaseFields = [
  ["prchsPlanQty", "물품수량", "integer"],
  ["prchsUntNm", "수량단위"],
  ["prchsPrnmntAmt", "구매예정금액\n(예산액)", "integer", "￦"],
] as const satisfies readonly Field[];

/** 일반 공사규모에 표시할 금액 필드. */
const constructionFields = [
  ["oderConrAmt", "발주도급금액", "integer", "￦"],
  ["oderGvspMrctAmt", "발주관급자재비", "integer", "￦"],
  ["oderEtcAmt", "발주기타금액", "integer", "￦"],
  ["oderSumAmt", "발주합계금액", "integer", "￦"],
  ["oderPrtmConrAmt", "발주금차\n도급금액", "integer", "￦"],
] as const satisfies readonly Field[];

/** 장기계약 공사규모에 표시할 집행 금액 필드. */
const longTermConstructionFields = [
  ["tyrImplAmt", "금년도집행금액", "integer", "￦"],
  ["implBlmt", "집행잔액", "integer", "￦"],
  ["pryrImplAmt", "전년도집행금액", "integer", "￦"],
  ["tlbkpngAmt", "총부기금액", "integer", "￦"],
] as const satisfies readonly Field[];

/** 응답 값을 HTML 디코딩하고 필드별 숫자·연월·전화번호 형식으로 변환한다. */
function formatValue(value: unknown, format: Field[2]) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text =
    typeof value === "string" ? decodeHTMLStrict(value) : String(value);
  if (!text.trim()) return "";

  if (format === "month") return formatG2bDisplayDate(text, "month");
  if (format === "dateTime") return formatG2bDisplayDateTime(text);
  if (format === "integer" || format === "decimal") {
    return formatG2bDisplayNumber(text, format === "integer" ? 0 : 2);
  }
  if (format === "phone") return formatG2bPhone(text) ?? text;
  return text;
}

/**
 * 나라장터 업무구분과 표시 조건을 적용해 발주계획 본문의 섹션과 필드를 순서대로 구성한다.
 * @param payload 발주계획 상세 응답. 구매주요규격 목록이 없어도 조회할 수 있다.
 * @returns 표시 대상 섹션과 라벨, 서식을 적용한 값, 단위가 포함된 행 목록.
 */
export function orderPlanSections(payload: OrderPlan["payload"]) {
  // 상세 본문의 단일 발주계획 데이터.
  const detail = payload.dlOderPlanM;
  // 원본 화면 분기에 사용하는 업무구분 코드.
  const code = detail.prcmBsneSeCd;
  // 물품·리스 계열 여부.
  const goods = code === "01" || code === "10";
  // 용역 계열 여부.
  const services = code === "03" || code === "05";
  // 외자 계열 여부.
  const foreign = code === "02" || code === "04" || code === "11";
  // 공사 업무 여부.
  const construction = code === "07";
  // 공사 중 WTO 적용 여부.
  const wto = construction && detail.wtoYn === "Y";
  // WTO가 아닌 공사 중 장기계약 유형 여부.
  const longTerm = construction && !wto && detail.newLotmSeCd === "신120002";

  /** 필드 정의를 순서대로 라벨·표시 값 행으로 변환해 섹션을 생성한다. */
  function section(title: string, fields: readonly Field[], data = detail) {
    return {
      title,
      rows: fields.map(([key, label, format, prefix, suffix]) => ({
        label,
        value: formatValue(data[key], format),
        prefix,
        suffix,
      })),
    };
  }

  // 공통 필드에서 시작해 업무별 기본정보 필드를 순서대로 추가한다.
  const basicFields: Field[] = [...commonFields];
  // 물품·리스 및 용역의 공통 계약 필드를 추가한다.
  if (goods || services) basicFields.push(...goodsAndServiceFields);
  // 물품·리스의 품명·규격·사업명과 조건부 자체분류 필드.
  if (goods) {
    // 자체물품 분류는 나라장터가 허용한 기관의 자체조달 물품에만 표시한다.
    if (
      code === "01" &&
      detail.prcmMthoSeCd === "조020002" &&
      typeof detail.oderInstUntyGrpNo === "string" &&
      ownGoodsInstitutions.has(detail.oderInstUntyGrpNo)
    ) {
      basicFields.push(
        ["iritemClsfNoUseYnNm", "자체물품분류번호 여부"],
        ["iritemClsfInfo", "자체물품분류번호"],
      );
    }
    basicFields.push(
      ["dtlsInfo", "세부품명번호"],
      ["itemIdnfNm", "품명"],
      ["itemUsagCn", "용도"],
      ["itemSpecCn", "주요규격"],
      ["bizNm", "사업명"],
    );
  }
  // 용역 기본정보의 장기계약 여부와 사업명.
  if (services) {
    basicFields.push(["newLotmSeCdNm", "장기계약여부"], ["bizNm", "사업명"]);
  }
  // 외자 기본정보의 관세·자금·품목 관련 필드.
  if (foreign) {
    basicFields.push(
      ["stdCtrtMthdCdNm", "계약방법"],
      ["dtlsInfo", "세부품명번호"],
      ["hskInfo", "관세분류번호(HSK)"],
      ["cptlSeCdNm", "자금구분"],
      ["cstrnPrdCn", "소요시기", "month"],
      ["itemNm", "구매품명(한글)"],
      ["engItemNm", "구매품명(영문)"],
      ["itemUsagCn", "용도"],
    );
  }
  // 공사 기본정보의 WTO·장기계약 조건별 필드.
  if (construction) {
    if (!longTerm) {
      basicFields.push(
        ["newLotmSeCdNm", "업무유형"],
        ["stdCtrtMthdCdNm", "계약방법"],
        ["scsbdMthdCdNm", "낙찰방법"],
      );
    }
    if (!wto) basicFields.push(["ctknSeNm", "공종"]);
    if (!wto && !longTerm) {
      basicFields.push(
        ["intbidTrgtYnNm", "국제입찰대상 여부"],
        ["agrtSeCdNm", "협정여부"],
        ["lgdngNm", "공사지역"],
      );
    }
    if (longTerm) basicFields.push(["cnxpCnvrYnNm", "계속비전환여부"]);
    basicFields.push(["bizNm", "사업명"]);
  }
  // 수의계약 방식인 경우에만 수의계약사유를 표시한다.
  if (
    (goods || services || foreign || construction) &&
    detail.stdCtrtMthdCd === "계030004"
  ) {
    basicFields.push(["pvctRsn", "수의계약사유"]);
  }

  // 원본에서 업무별 기본정보 그룹은 지원 코드가 선택될 때만 열린다.
  const sections =
    goods || services || foreign || construction
      ? [section("기본정보", basicFields)]
      : [];
  // 업무별 기본정보 뒤에 해당 규모·계획 섹션을 배치한다.
  if (goods) sections.push(section("구매계획 정보", purchaseFields));
  if (services)
    sections.push(
      section("용역규모", [["srvBgtAmt", "예산액", "integer", "￦"]]),
    );
  if (construction) {
    sections.push(
      section("공사규모", [
        ...(longTerm ? longTermConstructionFields : constructionFields),
        ["oderNtrsSplmAmt", "발주국고\n보조금액", "integer", "￦"],
        ["bgtCd", "예산코드"],
      ]),
    );
    // WTO 공사에서만 사전 공사내용 섹션을 추가한다.
    if (wto) {
      sections.push(
        section("사전 공사내용", [
          ["cstrnPrdCn", "공사기간"],
          ["dsdsPrslPlacNm", "설계서열람장소"],
          ["dsdsPrslPrdCn", "설계서열람기간"],
          ["cstrnRmrkCn", "비고"],
        ]),
      );
    }
  }
  if (foreign) {
    sections.push(
      section("규격공개모집", [
        ["fspcRcrtPbancNo", "공개모집번호"],
        ["rcrtDdlnDt", "공개모집마감일시", "dateTime"],
      ]),
      section("구매계획 정보", [
        ...purchaseFields,
        [
          "bgtCpltExrtAplcnYear",
          "예산편성환율\n기준연도",
          undefined,
          undefined,
          "년",
        ],
        ["bgtCpltExrt", "예산편성환율", "decimal", "USD"],
        ["frncCvrsPrchsPrnmntAmt", "달러환산금액", "decimal", "＄"],
      ]),
    );
    // 규격 항목을 순번별로 보관해 응답 배열 순서와 관계없이 짝을 맞춘다.
    const specifications = new Map<
      string,
      { fspcPritmNm?: unknown; fspcPritmVal?: unknown }
    >();
    if (Array.isArray(payload.dlSpecRlsRcrtPritmL)) {
      for (const item of payload.dlSpecRlsRcrtPritmL) {
        const sequence = String(item?.fspcPritmSqno);
        if (/^[1-5]$/.test(sequence)) specifications.set(sequence, item);
      }
    }
    // 항목명과 규격값을 임시 키(nameN, valueN)로 저장한다.
    const values: Record<string, unknown> = {};
    // 구매주요규격 화면에 표시할 라벨과 키의 순서 목록.
    const fields: Field[] = [];
    // 응답 순서가 달라도 항목명과 규격값이 같은 순번의 칸에 들어가야 한다.
    for (const sequence of ["1", "2", "3", "4", "5"]) {
      const item = specifications.get(sequence);
      values[`name${sequence}`] = item?.fspcPritmNm;
      values[`value${sequence}`] = item?.fspcPritmVal;
      fields.push([`name${sequence}`, `항목${sequence}`]);
    }
    // 항목명 1~5 다음에 규격값 1~5를 표시한다.
    for (const sequence of ["1", "2", "3", "4", "5"]) {
      fields.push([`value${sequence}`, `규격${sequence}`]);
    }
    sections.push(section("구매주요규격", fields, values));
  }
  // WTO 공사를 제외한 화면에 담당부서 정보 섹션을 추가한다.
  if (!wto) {
    sections.push(
      section("담당부서 정보", [
        ["tkcgDeptNm", "담당부서명"],
        ["picNm", "담당자"],
        ["picTlphNo", "전화번호", "phone"],
        ["picRmrkCn", "비고"],
      ]),
    );
  }
  // 구성한 섹션을 화면에 사용할 순서대로 반환한다.
  return sections;
}
