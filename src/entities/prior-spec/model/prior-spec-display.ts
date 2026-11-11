import { decodeHTMLStrict } from "entities";
import type { PriorSpec } from "./prior-spec";
import { formatG2bPhone } from "@/shared/lib/g2b-phone";
import {
  formatG2bDisplayDate,
  formatG2bDisplayDateTime,
  formatG2bDisplayNumber,
} from "@/shared/lib/g2b/g2b-display-format";

/** 기본정보의 한 항목을 표현한다. 추가 정보와 링크·금액 단위는 표시 단계에서 조합한다. */
type Row = {
  key: string;
  label: string;
  value: string;
  extra?: string;
  link?: string;
  prefix?: string;
  suffix?: string;
};

/** 목록 테이블의 열 정의. 필요한 열만 값 변환 함수를 지정한다. */
type Column = {
  key: string;
  label: string;
  format?: (value: unknown) => string;
};

// 자체물품분류번호 열을 표시하는 대상 기관 번호.
const ownItemAgencies = new Set([
  "IN0100000059188",
  "IN0100000029951",
  "IN0100000062735",
  "IN0100000031685",
  "IN0100000014181",
]);

/**
 * API 필드값을 화면에 사용할 문자열로 변환하고 HTML 엔터티를 해제한다.
 * @param value 원본 필드값. 숫자와 문자열 이외의 값은 빈 문자열로 처리한다.
 * @returns 화면 표시용 문자열.
 */
function text(value: unknown) {
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? decodeHTMLStrict(value) : "";
}

/**
 * 숫자로 해석할 수 있는 값만 지정된 형식으로 표시한다.
 * @param value 원본 금액 또는 수량.
 * @param maximumFractionDigits 최대 소수 자릿수. 외자 금액은 셋째 자리까지 표시한다.
 * @returns 숫자 형식이 적용된 문자열 또는 변환하지 않은 원본 문자열.
 */
function numberText(value: unknown, maximumFractionDigits: 0 | 3 = 0) {
  return formatG2bDisplayNumber(text(value), maximumFractionDigits);
}

// 목록 공통 순번 열과 수요기관 담당자·의견 목록의 표시 열을 정의한다.
const serialColumn = { key: "no", label: "No" };
const agencyColumns: Column[] = [
  serialColumn,
  { key: "deptNm", label: "부서명" },
  { key: "picNm", label: "담당자" },
  {
    key: "faxNo",
    label: "팩스번호",
    // 전화번호와 팩스번호 모두 나라장터 공통 형식으로 표시한다.
    format: (value) => formatG2bPhone(text(value)) ?? "",
  },

  {
    key: "tlphNo",
    label: "전화번호",
    format: (value) => formatG2bPhone(text(value)) ?? "",
  },
];
const opinionColumns: Column[] = [
  serialColumn,
  { key: "opnnNm", label: "제목" },
  { key: "ogdpNm", label: "소속" },
  { key: "wrtrNm", label: "성명" },
  {
    key: "inptDt",
    label: "등록일시",
    format: (value) => formatG2bDisplayDateTime(text(value)),
  },
];

/**
 * 목록 응답이 배열이 아닐 때도 테이블 구성을 계속할 수 있도록 빈 목록으로 정규화한다.
 * @param value API에서 받은 목록 데이터.
 * @returns 행 객체 배열.
 */
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 열 정의 순서대로 목록 값을 변환하고 화면용 테이블 데이터를 만든다.
 * @param title 테이블 제목.
 * @param columns 표시할 열과 값 변환 규칙.
 * @param source 원본 행 목록.
 * @returns 제목, 열 정의, 표시용 행을 포함한 테이블.
 */
function table(
  title: string,
  columns: Column[],
  source: Record<string, unknown>[],
) {
  return {
    title,
    columns,
    rows: source.map((item, index) =>
      columns.map(({ key, format = text }) =>
        key === "no" ? String(index + 1) : format(item?.[key]),
      ),
    ),
  };
}

/**
 * 나라장터 업무구분과 연계 조건에 따라 사전규격의 상세 행과 복합 목록을 구성한다.
 * @param payload 저장된 사전규격 상세 응답. 목록이 없으면 표시 대상 목록을 빈 상태로 구성한다.
 * @returns 원본 순서의 기본정보 행, 첨부 앞의 목록, 첨부 뒤의 의견 목록.
 */
export function priorSpecDisplay(payload: PriorSpec["payload"]) {
  const detail = payload.dlBfSpecM;
  // 업무구분에 따라 원본 화면의 필드·테이블 표시 여부가 달라진다.
  const code = detail.prcmBsneSeCd;
  const goods = code === "01";
  const foreign = code === "02" || code === "04";
  const service = code === "03" || code === "05";
  const construction = code === "07";
  const reserve = code === "12";
  const url = text(detail.pbancInstUrl).trim();
  // 전자문서번호와 기관 URL이 모두 있을 때만 연계기관 안내와 관련 열을 표시한다.
  const linked = Boolean(text(detail.edocNo).trim() && url);
  // 공고기관명과 별개로 담당자명·전화번호를 묶어 추가 정보로 전달한다.
  const contactName = text(detail.pbancBsneNm);
  const contactPhone = formatG2bPhone(text(detail.pbancBsneTel)) ?? "";
  const contact = contactPhone.trim()
    ? `${contactName} ( ${contactPhone} )`.trimStart()
    : contactName;

  // 단일 필드는 API 키를 유지한 채 화면용 행으로 변환한다.
  const field = (
    key: string,
    label: string,
    format = (value: string) => value,
  ): Row => ({
    key,
    label,
    value: format(text(detail[key])),
  });
  // 원본 기본정보의 표시 순서를 유지하며 업무구분별 조건부 필드를 삽입한다.
  const rows = [field("bfSpecRegNo", "사전규격등록번호")];
  if (!reserve) {
    rows.push(field("oderPlanNo", "발주계획통합번호"));
    if (text(detail.ctrtDmndRcptNo).trim())
      rows.push(field("ctrtDmndRcptNo", "조달요청접수번호"));
  }
  rows.push(
    field("prcmBsneSeCdNm", "업무구분"),
    field("bfSpecNm", "사전규격명"),
    field("dmstUntyGrpNm", "수요기관"),
    { ...field("pbancInstUntyGrpNm", "공고기관"), extra: contact },
    field("usrDocNoVal", "참조번호"),
  );
  if (reserve) rows.push(field("rsrvSeCdNm", "비축구분"));
  if (goods || service) rows.push(field("swBizTrgtYnNm", "SW사업대상"));
  // 공사 업무에서만 수의계약 관련 항목을 표시하고, 대상일 때 사유·근거를 추가한다.
  if (construction) {
    rows.push(field("pvctTrgtYnNm", "수의계약대상"));
    if (detail.pvctTrgtYn === "Y") {
      rows.push(
        field("pvctRsn", "수의계약사유"),
        field("pvctBassAtcsCd", "법적근거"),
      );
    }
  }
  // 예산 항목은 업무구분에 따라 제목·통화 단위·소수점 형식이 달라진다.
  rows.push(
    {
      key: "alotBgtPrspAmt",
      label: construction
        ? "예산금액"
        : foreign
          ? "배정예산액"
          : "배정예산액\n(부가세포함)",
      value: numberText(detail.alotBgtPrspAmt, foreign ? 3 : 0),
      prefix: foreign ? "$" : undefined,
      suffix: foreign ? undefined : "원",
    },
    field("opnnRegDdlnDt", "의견등록마감일시", formatG2bDisplayDateTime),
  );
  // 외자·공사에서는 납품기한 항목을 표시하지 않는다.
  if (!foreign && !construction) {
    // 날짜가 있으면 날짜를, 없으면 납품일수 안내를 표시한다.
    const date = text(detail.dlvgdsTermYmd).trim();
    rows.push({
      key: "dlvgdsTerm",
      label: "납품(완수)기한\n(납품일수)",
      value: date
        ? formatG2bDisplayDate(date, "date")
        : `(${service ? "착수 후" : "계약 후"} ${numberText(detail.dlvgdsTermNody)}일 이내)`,
    });
  }
  // 공개일시는 실제 값이 있을 때만 기본정보에 추가한다.
  if (text(detail.specRlsDt).trim())
    rows.push(field("specRlsDt", "사전규격 공개일시", formatG2bDisplayDateTime));
  // 연계기관 공고는 원문 URL과 안내 문구를 별도 항목으로 제공한다.
  if (linked) {
    rows.push({
      key: "linkedDetail",
      label: "사전규격 상세정보",
      value: url,
      link: /^https?:\/\//i.test(url) ? url : undefined,
      extra: `본 규격은 나라장터 연계기관인 ${text(detail.dmstUntyGrpNm)}에서 공개한 규격입니다. 자세한 정보확인 및 의견등록은 아래 주소를 클릭하시어 진행하시기 바랍니다.`,
    });
  }

  // 기본정보 아래에 표시할 복합 목록을 원본 순서대로 구성한다.
  const tables: ReturnType<typeof table>[] = [];
  if (goods || reserve) {
    const items = records(payload.dlBfSpecItemL);
    const columns: Column[] = [serialColumn];
    // 물품 업무 중 지정된 기관에만 자체물품분류번호 열을 표시한다.
    if (goods && ownItemAgencies.has(text(detail.kbrdrUntyGrpNo))) {
      columns.push({ key: "iritemClsfNo", label: "자체물품분류번호" });
    }
    columns.push(
      { key: "dtlsPrnmNo", label: "세부품명번호" },
      { key: "dtlsPrnmNm", label: "세부품명" },
    );
    // 원본은 수량이 0 이하인 행이 있으면 열 전체를 숨긴다.
    if (!items.some((item) => Number(item?.itemQty) <= 0)) {
      columns.push({ key: "itemQty", label: "물품수량", format: numberText });
    }
    // 연계된 물품정보가 존재하는 경우에만 물품분류명 열을 표시한다.
    if (linked && items.length)
      columns.push({ key: "itemCfnm", label: "물품분류명" });
    tables.push(table("물품정보", columns, items));
  }
  // 외자 업무 중 해당 조달방식에서만 수요기관 담당자 목록을 표시한다.
  if (foreign && detail.prcmMthoSeCd === "조020001") {
    tables.push(
      table("수요기관담당자", agencyColumns, records(payload.dlDmstPicRcptL)),
    );
  }
  // 연계기관 공고는 의견 목록을 숨기며, 공사는 설계서 의견으로 명칭을 바꾼다.
  const opinions = linked
    ? undefined
    : table(
        construction ? "설계서 의견" : "규격서 의견",
        opinionColumns,
        records(payload.dlBfSpecOpnnL),
      );

  return { title: text(detail.bfSpecNm), rows, tables, opinions };
}
