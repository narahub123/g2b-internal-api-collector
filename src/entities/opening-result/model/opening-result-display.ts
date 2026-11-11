import {
  formatG2bDisplayText,
  type G2bDisplayFormat,
} from "@/shared/lib/g2b/g2b-display-format";
import {
  resolveOpeningResultEndpoint,
  type OpeningResultEndpoint,
  type OpeningResultQuery,
  type OpeningResultPrice,
} from "./opening-result";

type Data = Record<string, unknown>;
export type DisplayField = {
  key: string;
  label: string;
  value: unknown;
  /** 원본 화면의 클릭 가능한 공고번호만 내부 공고 상세로 연결한다. */
  href?: string;
  /** 원본 JS에 정의된 조회/선택/안내 항목. 실제 클릭 동작은 UI에서 별도 연결한다. */
  control?: "action" | "select" | "notice" | "detail";
  /** 원본 WebSquare 요소 ID. */
  originalId?: string;
};
export type DisplayTable = {
  columns: { key: string; label: string }[];
  rows: Data[];
};
export type OpeningResultDisplay = {
  status: string;
  sections: (
    | { kind: "fields"; title: string; fields: DisplayField[] }
    | { kind: "table"; title: string; table: DisplayTable }
  )[];
};

const isData = (value: unknown): value is Data =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hasValue = (value: unknown) =>
  value !== null && value !== undefined && value !== "";
const field = (key: string, label: string) => ({ key, label });

// 상태별 개찰 API와 예비가격 API에서 실제로 노출하는 수치·일시만 변환한다.
// 외자·비축 가격과 수수료율은 응답이 제공한 소수부를 보존한다.
const fieldFormats: Readonly<Record<string, G2bDisplayFormat>> = {
  realOnbsDt: "dateTime",
  realOnbsPrnmntDt: "dateTime",
  slprRcptDdlnDt: "dateTime",
  jsagrSbmsnDdlnDt: "dateTime",
  onbsPrnmntDt: "dateTime",
  slprRcptnDt: "dateTime",
  inptDt: "dateTime",
  budget: "integer",
  bidQty: "decimal",
  prchsDtlItemQty: "decimal",
  prchsDtlItemUprc: "decimal",
  onbsRnkg: "integer",
  bdngAmt: "decimal",
  bdrt: "decimal",
  hopeQty: "decimal",
  bpfaaExclBdrt: "decimal",
  bdngItrt: "decimal",
  bidWght: "decimal",
  trffRat: "decimal",
  lmeOfntPrce: "decimal",
  cvrsUprc: "decimal",
  upRsvePrceCrtTnum: "integer",
  goalItrt: "decimal",
  pnpr: "decimal",
  bsamt: "decimal",
  pnprPcsp: "integer",
  bsamtPcsp: "integer",
  plrlRsvePrce1: "decimal",
  plrlRsvePrce2: "decimal",
  drawNotm1: "integer",
  drawNotm2: "integer",
};

function displayFieldValue(key: string, value: unknown): unknown {
  const format = fieldFormats[key];
  return format && (typeof value === "string" || typeof value === "number")
    ? formatG2bDisplayText(String(value), format)
    : value;
}

/** 표시할 열만 별도 행에 포맷하고 API 행은 보존한다. */
function displayTableRows(
  rows: Data[],
  columns: DisplayTable["columns"],
): Data[] {
  return rows.map((row) => ({
    ...row,
    ...Object.fromEntries(
      columns
        .filter(({ key }) => fieldFormats[key] && Object.hasOwn(row, key))
        .map(({ key }) => [key, displayFieldValue(key, row[key])]),
    ),
  }));
}

/**
 * OnbsRsltAllUsrV-2.js 각 sBid*Box의 공고정보 행 정의.
 * 빈 값의 일반 필드는 표시하지 않되, 정의 자체는 절대 삭제하지 않는다.
 * 조회/선택/안내 행은 값 필드와 구별하여 원본 요소 ID를 보존한다.
 * UI에서 아직 구현하지 않은 동작을 가짜 버튼이나 링크로 대체하지 않는다.
 */
type NoticeFieldDefinition = {
  key: string;
  label: string;
  source?: "bidInfo" | "etcData" | "query" | "detail";
  control?: DisplayField["control"];
  originalId?: string;
};
const bid = (key: string, label: string): NoticeFieldDefinition => ({
  key,
  label,
  source: "bidInfo",
});
const etc = (key: string, label: string): NoticeFieldDefinition => ({
  key,
  label,
  source: "etcData",
});
const control = (
  key: string,
  label: string,
  kind: NonNullable<DisplayField["control"]>,
  originalId?: string,
): NoticeFieldDefinition => ({ key, label, control: kind, originalId });

const common = {
  number: bid("bidPbancNoPbancOrd", "입찰공고번호"),
  reference: bid("usrDocNoVal", "참조번호"),
  date: bid("realOnbsDt", "실제개찰일시"),
  name: bid("bidPbancNm", "입찰공고명"),
  agency: bid("pbancInstUntyGrpNm", "공고기관"),
  demand: bid("dmstNm", "수요기관"),
  officer: bid("bidBlffNm", "집행관"),
  manager: bid("picNm", "공고담당자"),
  review: control("qualificationReview", "적격심사결과", "action"),
  price: control("reservePrice", "복수예비가격 및 예정가격", "detail"),
  equalPrice: control("samePrice", "동일가격 추첨결과", "action"),
  technical: control("technicalEvaluation", "기술평가점수 조회", "action"),
  proposal: control("proposalEvaluation", "규격제안서 평가결과", "action"),
  notice: control("precautions", "유의사항", "notice"),
  rebid: control("rebidNumber", "재입찰번호", "select"),
  outcome: control("bidOutcome", "입찰결과", "notice"),
} as const;

const noticeFieldsByEndpoint: Partial<
  Record<OpeningResultEndpoint, readonly NoticeFieldDefinition[]>
> = {
  selectOnbsRsltSbidGods: [
    common.number,
    common.reference,
    common.date,
    common.name,
    common.agency,
    common.demand,
    { ...common.review, originalId: "btnQlemRslt" },
    common.officer,
    { ...common.price, originalId: "godsBtnRsvePrce" },
    common.manager,
    { ...common.equalPrice, originalId: "godsBtnSamePrice" },
    { ...common.technical, originalId: "btnGodsEvalRslt" },
    { ...common.proposal, originalId: "btnSpecPrplEvlRslt" },
    common.notice,
    { ...common.rebid, originalId: "godsSelectBidPrgrsOrd" },
    { ...common.outcome, originalId: "godsBidPrgrsOrdTxt" },
  ],
  selectOnbsRsltSbidSrvc: [
    common.number,
    common.reference,
    common.date,
    common.name,
    common.agency,
    common.demand,
    { ...common.review, originalId: "srvcBtnQlemRslt" },
    common.officer,
    { ...common.price, originalId: "srvcBtnRsvePrce" },
    { ...common.equalPrice, originalId: "srvcBtnSamePrice" },
    { ...common.technical, originalId: "btnSrvcEvalRslt" },
    { ...common.proposal, originalId: "srvcBtnSpecPrplEvlRslt" },
    control(
      "designEvaluation",
      "설계공모 평가결과",
      "action",
      "srvcBtnDesignPbcsEvlRslt",
    ),
    common.notice,
    { ...common.rebid, originalId: "srvcSelectBidPrgrsOrd" },
    { ...common.outcome, originalId: "srvcBidPrgrsOrdTxt" },
  ],
  selectOnbsRsltSbidCstn: [
    common.number,
    common.reference,
    common.date,
    common.name,
    common.agency,
    common.demand,
    { ...common.review, originalId: "cstnBtnQlemRslt" },
    common.officer,
    { ...common.price, originalId: "cstnBtnRsvePrce" },
    etc("budget", "공사예정금액(추정금액)"),
    { ...common.equalPrice, originalId: "cstnBtnSamePrice" },
    control(
      "comprehensiveReview",
      "종합심사/종합평가 입찰금액 심사결과",
      "action",
      "btnBidAmtSrngRsltExcelDwnld",
    ),
    common.notice,
    { ...common.rebid, originalId: "cstnSelectBidPrgrsOrd" },
    { ...common.outcome, originalId: "cstnBidPrgrsOrdTxt" },
  ],
  selectOnbsRsltSbidFrcp: [
    common.number,
    common.reference,
    common.date,
    common.name,
    common.demand,
    etc("bidQty", "수량"),
    etc("unit", "단위"),
    control("prNo", "PR No.", "notice"),
    { ...common.technical, originalId: "btnTechElgd" },
    { ...common.rebid, originalId: "frcpSelectBidPrgrsOrd" },
    { ...common.outcome, originalId: "frcpBidPrgrsOrdTxt" },
  ],
  selectOnbsRsltSbidLase: [
    common.number,
    { key: "bidClsfNo", label: "입찰분류", source: "query" },
    common.date,
    common.name,
    common.agency,
    common.demand,
    common.manager,
    common.officer,
    common.notice,
    { ...common.rebid, originalId: "laseSelectBidPrgrsOrd" },
    { ...common.outcome, originalId: "laseBidPrgrsOrdTxt" },
  ],
  selectOnbsRsltSbidRsrv: [
    common.number,
    { key: "bidClsfNo", label: "입찰분류", source: "query" },
    { ...common.date, label: "개찰일시" },
    common.name,
    etc("itrlPrcmItemIdnfNm", "세부품명"),
    etc("itemDtlSpecCn", "세부품명(규격)"),
    { ...common.equalPrice, originalId: "rsrvBtnSamePrice" },
    common.notice,
    { ...common.rebid, originalId: "rsrvSelectBidPrgrsOrd" },
    { ...common.outcome, originalId: "rsrvBidPrgrsOrdTxt" },
  ],
};

/** 원본 화면의 전체 필드 정의(값이나 표시 조건과 무관). */
export function getOpeningResultNoticeFieldDefinitions(
  endpoint: OpeningResultEndpoint,
): readonly NoticeFieldDefinition[] {
  return noticeFieldsByEndpoint[endpoint] ?? [];
}

/**
 * OnbsRsltAllUsrV-2.js의 개찰완료 초기 hide 및 API 응답 후 show/hide 조건.
 * 필드 정의(noticeFieldsByEndpoint)는 수정하지 않는다.
 */
function isNoticeControlVisible(
  endpoint: OpeningResultEndpoint,
  key: string,
  bidInfo: Data,
  etcData: Data,
): boolean {
  const isTruthy = (value: unknown) => Boolean(value);
  const opened = etcData.openYn === "Y";
  const isDesign =
    endpoint === "selectOnbsRsltSbidSrvc" && isTruthy(etcData.isPssrp);
  const rebidVisible =
    isTruthy(etcData.isRebidResultShow) &&
    Number(etcData.maxBidPrgrsOrd) > 0 &&
    (bidInfo.bidMthdCd === "입180002" || bidInfo.bidMthdCd === "입180008");

  switch (key) {
    case "qualificationReview":
      return (
        !isDesign &&
        (bidInfo.scsbdMthdCd === "낙030001" ||
          bidInfo.scsbdMthdCd === "낙030033")
      );
    case "reservePrice":
      // 용역 설계공모에서는 기본사항 행 자체를 숨긴다.
      return !isDesign;
    case "samePrice":
      return etcData.isSamePriceYn === "Y";
    case "technicalEvaluation":
      if (endpoint === "selectOnbsRsltSbidFrcp")
        return etcData.negoYn === "Y" && etcData.eeOrderEvalYn === "Y";
      return (
        opened &&
        (isTruthy(etcData.isNego) ||
          (isTruthy(etcData.isCmpetDialgBid) && etcData.epropoEvalYn === "Y"))
      );
    case "proposalEvaluation":
      return (
        opened &&
        (isTruthy(etcData.isTwoStepCompetYn) ||
          isTruthy(etcData.isStdPrcConcurYn))
      );
    case "designEvaluation":
      return isDesign && opened;
    case "comprehensiveReview":
      return (
        isTruthy(etcData.isGnrlzJdgmnScsbid) &&
        isTruthy(etcData.isGnrlzJdgmnScsbidResultYn)
      );
    case "prNo":
      // 외자 조회 후 원본 JS에서 prNoGrp.hide()를 호출한다.
      return false;
    case "rebidNumber":
    case "bidOutcome":
      // 입찰결과 표시도 재입찰번호 선택 그룹을 표시할 때 설정한다.
      return rebidVisible;
    case "precautions":
      if (
        endpoint === "selectOnbsRsltSbidGods" ||
        endpoint === "selectOnbsRsltSbidSrvc"
      )
        return (
          isTruthy(etcData.isCmpetDialgBid) ||
          isTruthy(etcData.isNego) ||
          bidInfo.prnmntPrceDcsnMthoCd !== "예050001" ||
          isDesign
        );
      if (endpoint === "selectOnbsRsltSbidCstn")
        return (
          isTruthy(etcData.isTunkeyBid) ||
          isTruthy(etcData.isNewQlfdJudgeAamtExclWbidMethodCdYn) ||
          bidInfo.prnmntPrceDcsnMthoCd !== "예050001"
        );
      return true;
    default:
      // 원본에 별도의 숨김 조건이 없는 항목은 임의로 제외하지 않는다.
      return true;
  }
}

function noticeDisplayFields(
  endpoint: OpeningResultEndpoint,
  query: OpeningResultQuery,
  detail: Data,
): DisplayField[] {
  const bidInfo = isData(detail.bidInfo) ? detail.bidInfo : {};
  const etcData = isData(detail.etcData) ? detail.etcData : {};
  const queryData = query as unknown as Data;
  return getOpeningResultNoticeFieldDefinitions(endpoint).flatMap(
    (definition) => {
      if (definition.control) {
        if (!isNoticeControlVisible(endpoint, definition.key, bidInfo, etcData))
          return [];
        // UI에 연결되지 않은 조회 동작을 실제 데이터인 것처럼 표시하지 않는다.
        // 정의와 원본 ID를 유지하여 이후 UI 연결 시 원본 위치에 삽입한다.
        return [
          {
            key: definition.key,
            label: definition.label,
            value: undefined,
            control: definition.control,
            originalId: definition.originalId,
          },
        ];
      }
      const source =
        definition.source === "etcData"
          ? etcData
          : definition.source === "query"
            ? queryData
            : definition.source === "detail"
              ? detail
              : bidInfo;
      const value =
        definition.key === "bidClsfNo"
          ? (queryData.classification ?? bidInfo.bidClsfNo)
          : source[definition.key];
      if (!hasValue(value)) return [];
      return [
        {
          key: definition.key,
          label: definition.label,
          value: displayFieldValue(definition.key, value),
        },
      ];
    },
  );
}

// OnbsRsltAllUsrV-2.js 각 gridView의 header와 gBody를 순서대로 대조한 열 정의.
// 원본 hidden=true인 No(rowNum)는 제외한다. 값이 없어도 원본의 열 자체는 유지한다.
// 버튼 전용 열(btnJsda, btnReBdng, srchBid, srchDtl)은 실제 동작 없이
// 가짜 텍스트/버튼을 출력하지 않도록 별도 기능 구현 전까지 제외한다.
const resultColumns: Record<
  OpeningResultEndpoint,
  { key: string; label: string }[]
> = {
  selectOnbsRsltFbid: [],
  selectOnbsRsltRbid: [
    field("bidPbancNoOrd", "입찰공고번호"),
    field("bidPrgrsOrd", "재입찰번호"),
    field("bidPbancNm", "공고명"),
    field("grpNm", "수요기관"),
    field("bidCtrtMthdNm", "계약방법"),
    field("dtlsPrnmNo", "세부품명번호"),
    field("dtlsPrnm", "세부품명"),
    field("prchsDtlItemQty", "수량"),
    field("prchsDtlItemUntNm", "단위"),
    field("dtlSpecCn", "규격"),
    field("prchsDtlItemUprc", "단가"),
    field("slprRcptDdlnDt", "입찰서마감일시"),
    field("jsagrSbmsnDdlnDt", "협정서마감일시"),
    field("onbsPrnmntDt", "개찰일시"),
  ],
  selectOnbsRsltSbidGods: [
    field("onbsRnkg", "순위"),
    field("bzmnRegNo", "사업자등록번호"),
    field("grpNm", "업체명"),
    field("rprsvNm", "대표자명"),
    field("bdngAmt", "입찰금액(원)"),
    field("bdrt", "투찰률(%)"),
    field("hopeQty", "수량"),
    field("rsvePrceNoVal", "추첨번호"),
    field("slprRcptnDt", "투찰일시"),
    field("etc", "비고"),
  ],
  selectOnbsRsltSbidSrvc: [
    field("onbsRnkg", "순위"),
    field("bzmnRegNo", "사업자등록번호"),
    field("grpNm", "업체명"),
    field("rprsvNm", "대표자명"),
    field("bdngAmt", "투찰금액(원)"),
    field("bdrt", "투찰률(%)"),
    field("rsvePrceNoVal", "추첨번호"),
    field("slprRcptnDt", "투찰일시"),
    field("bidUfnsRsn", "비고"),
  ],
  selectOnbsRsltSbidCstn: [
    field("onbsRnkg", "순위"),
    field("bzmnRegNo", "사업자등록번호"),
    field("grpNm", "업체명"),
    field("rprsvNm", "대표자명"),
    field("bdngAmt", "투찰금액(원)"),
    field("bdrt", "투찰률(%)"),
    field("bpfaaExclBdrt", "(입찰가격 – A)/(예정가격 – A) * 100"),
    field("rsvePrceNoVal", "추첨번호"),
    field("slprRcptnDt", "투찰일시"),
    field("bidUfnsRsn", "비고"),
    field("mtltyMrktAdvcPermsnYn", "상호시장 진출여부"),
  ],
  selectOnbsRsltSbidFrcp: [
    field("rowNum", "No"),
    field("grpNm", "업체명"),
    field("orgpAntpSe", "구분"),
    field("itemNo", "입찰분류번호"),
    field("spplEtpsNm", "공급자"),
    field("bdngAmt", "입찰금액"),
    field("dmstSlprRvwRslt", "개찰결과"),
    field("evlResult", "입찰서평가 결과"),
    field("makrNm", "제작자"),
  ],
  selectOnbsRsltSbidLase: [
    field("onbsRnkg", "순위"),
    field("bzmnRegNo", "사업자등록번호"),
    field("grpNm", "업체명"),
    field("rprsvNm", "대표자명"),
    field("bdngItrt", "투찰금리(%)"),
    field("etc", "부적격사유"),
  ],
  selectOnbsRsltSbidRsrv: [
    field("onbsRnkg", "순위"),
    field("bidClsfNo", "ITEM No"),
    field("grpNm", "업체명"),
    field("bidWght", "중량(수량)"),
    field("bdngAmt", "입찰금액(프리미엄/확정계약)"),
    field("plorNm1", "원산지"),
    field("trffRat", "관세율(%)"),
    field("lmeOfntPrce", "LME가격"),
    field("cvrsUprc", "환산금액"),
    field("inptDt", "입력시각"),
    field("etc", "비고"),
  ],
};

/**
 * 원본 gridView의 setColumnVisible 조건을 표시 모델에서 적용한다.
 * API 원본을 변경하지 않으며, 원본이 숨긴 열은 값이 있어도 표시하지 않는다.
 */
function visibleResultColumns(
  endpoint: OpeningResultEndpoint,
  query: OpeningResultQuery,
  detail: Data,
): { key: string; label: string }[] {
  const hidden = new Set<string>();
  const bidInfo = isData(detail.bidInfo) ? detail.bidInfo : {};
  const etcData = isData(detail.etcData) ? detail.etcData : {};

  if (
    endpoint === "selectOnbsRsltSbidSrvc" &&
    bidInfo.scsbdMthdCd === "낙030017"
  ) {
    // 설계공모에서는 투찰일시·금액·투찰률·추첨번호를 표시하지 않는다.
    ["slprRcptnDt", "bdngAmt", "bdrt", "rsvePrceNoVal"].forEach((key) =>
      hidden.add(key),
    );
  }
  if (endpoint === "selectOnbsRsltSbidCstn") {
    if (etcData.mtltyMrktAdvcPermsnYn !== "Y")
      hidden.add("mtltyMrktAdvcPermsnYn");
    if (etcData.bidPcAamtExclBiddingRatioYn !== "Y")
      hidden.add("bpfaaExclBdrt");
  }
  if (endpoint === "selectOnbsRsltRbid") {
    const business = String(query.businessCode ?? "");
    if (
      ["01", "02", "04", "12", "13", "03", "10", "11", "14"].includes(business)
    ) {
      hidden.add("bidCtrtMthdNm");
      hidden.add("bidPbancNm");
    }
    if (["10", "11", "14"].includes(business)) hidden.add("jsagrSbmsnDdlnDt");
    if (["05", "07"].includes(business)) {
      [
        "dtlsPrnmNo",
        "dtlsPrnm",
        "prchsDtlItemQty",
        "prchsDtlItemUntNm",
        "dtlSpecCn",
        "prchsDtlItemUprc",
      ].forEach((key) => hidden.add(key));
    }
    const rows = Array.isArray(detail.reBidInfo) ? detail.reBidInfo : [];
    if (isData(rows[0]) && rows[0].aagrSbmsnElctHdwrSeCd === "전010003") {
      hidden.add("jsagrSbmsnDdlnDt");
    }
  }
  return resultColumns[endpoint].filter(({ key }) => !hidden.has(key));
}

function selectedFields(
  source: Data,
  definitions: readonly { key: string; label: string }[],
): DisplayField[] {
  return definitions
    .filter(({ key }) => hasValue(source[key]))
    .map(({ key, label }) => ({ key, label, value: source[key] }));
}

/** 개찰 원본에 연결된 공고의 번호와 차수를 구한다. 원본에 값이 없으면 조회 식별자를 사용한다. */
export function openingResultNoticeKey(query: OpeningResultQuery, detail: Data) {
  const bidInfo = isData(detail.bidInfo) ? detail.bidInfo : undefined;
  if (!bidInfo) return undefined;
  const number = typeof bidInfo.bidPbancNo === "string" && bidInfo.bidPbancNo
    ? bidInfo.bidPbancNo
    : query.number;
  const revision = String(bidInfo.bidPbancOrd ?? query.revision);
  return number && revision ? { number, revision: revision.padStart(3, "0") } : undefined;
}

/**
 * 원본 응답의 섹션과 필드를 표시 모델로 변환한다. 원본에 없는 안내문은 만들지 않는다.
 * @param noticePath 연결 공고의 주소를 만든다. 주소가 없으면 원본 필드값만 표시한다.
 */
export function getOpeningResultDisplay(
  query: OpeningResultQuery,
  detail: Data,
  noticePath: (key: { number: string; revision: string }) => string | undefined,
): OpeningResultDisplay {
  const endpoint = resolveOpeningResultEndpoint(query);
  const status = query.status ?? "유찰"; // 구형 저장 JSON 호환
  const sections: OpeningResultDisplay["sections"] = [];
  if (!endpoint) return { status, sections };

  // OnbsRsltAllUsrV-2.js: 상태별 실제 화면 제목과 필드 레이블을 사용한다.
  // 유찰/취소/재입찰 화면에서는 개찰완료 전용 '공고정보' 영역을 표시하지 않는다.
  if (endpoint === "selectOnbsRsltFbid") {
    const isCancelled = status === "입찰취소";
    sections.push({
      kind: "fields",
      title: isCancelled ? "입찰이 취소되었습니다." : "유찰되었습니다.",
      fields: [
        {
          key: "prcsRsn",
          label: isCancelled ? "취소사유" : "유찰사유",
          value: detail.prcsRsn,
        },
      ],
    });
    return { status, sections };
  }

  if (endpoint === "selectOnbsRsltRbid") {
    sections.push({
      kind: "fields",
      title: "재입찰 되었습니다.",
      fields: [{ key: "prcsRsn", label: "재입찰 사유", value: detail.prcsRsn }],
    });
  } else {
    const bidInfo = isData(detail.bidInfo) ? detail.bidInfo : undefined;
    if (bidInfo) {
      const fields = noticeDisplayFields(endpoint, query, detail);
      if (
        !fields.some(({ key }) => key === "bidPbancNoPbancOrd") &&
        hasValue(bidInfo.bidPbancNo)
      ) {
        fields.unshift({
          key: "bidPbancNoPbancOrd",
          label: "입찰공고번호",
          value: `${bidInfo.bidPbancNo}-${bidInfo.bidPbancOrd ?? query.revision}`,
        });
      }
      // 원본의 공고번호 링크를 프로젝트 내부 상세로 연결한다.
      const key = openingResultNoticeKey(query, detail);
      const noticeNumber = fields.find(
        ({ key }) => key === "bidPbancNoPbancOrd",
      );
      if (noticeNumber && key) {
        noticeNumber.href = noticePath(key);
      }
      if (fields.length)
        sections.push({ kind: "fields", title: "공고정보", fields });
    }
  }

  const rawRows =
    endpoint === "selectOnbsRsltRbid"
      ? detail.reBidInfo
      : detail.successBidInfo;
  const rows = Array.isArray(rawRows) ? rawRows.filter(isData) : [];
  const columns = visibleResultColumns(endpoint, query, detail);
  sections.push({
    kind: "table",
    title: endpoint === "selectOnbsRsltRbid" ? "개찰결과" : "목록",
    table: { rows: displayTableRows(rows, columns), columns },
  });
  return { status, sections };
}

/** RsvePrceCmpuRsltPL.js의 팝업 섹션 순서와 조건부 행을 적용한다. */
export function getOpeningResultPriceDisplay(
  price: OpeningResultPrice,
): OpeningResultDisplay {
  const pbanc = price.pbancInfo;
  const amount = price.bsisAmtInfo ?? {};
  const calc = price.plrlRsvePrceCalcInfo ?? {};
  const pcsp = price.pcspInfo ?? {};
  const method = pbanc.prnmntPrceDcsnMthoCd;
  const isMultiple = method === "예050003";
  const isNoPrice = method === "예050001";
  const isRate = pbanc.prspFeeRatBdngYn === "Y";
  const isInterest =
    method === "예050002" &&
    ["10", "11", "14"].includes(String(pbanc.prcmBsneSeCd ?? ""));
  const fields: DisplayField[] = [];
  const add = (key: string, label: string, value: unknown) => {
    fields.push({ key, label, value: displayFieldValue(key, value) });
  };

  // 공고정보: 원본 팝업의 테이블 행 순서.
  add("bidPbancNoPbancOrd", "입찰공고번호", pbanc.bidPbancNoPbancOrd);
  add("bidClsfNo", "입찰분류", pbanc.bidClsfNo);
  add("bidPrgrsOrd", "재입찰번호", pbanc.bidPrgrsOrd);
  add("bidPbancNm", "입찰공고명", pbanc.bidPbancNm);
  add("usrDocNoVal", "참조번호", pbanc.usrDocNoVal);
  add("lcrtTyCdNm", "계약법구분", pbanc.lcrtTyCdNm);
  add("realOnbsPrnmntDt", "실제 개찰일시", pbanc.realOnbsPrnmntDt);

  if (
    hasValue(calc.prceCrtRangRtNm) &&
    isMultiple &&
    ["입180002", "입180008", "입180010"].includes(String(pbanc.bidMthdCd ?? ""))
  ) {
    add(
      "prceCrtRangRtNm",
      isRate ? "예비수수료율범위" : "예비가격범위",
      calc.prceCrtRangRtNm,
    );
    add(
      "upRsvePrceCrtTnum",
      isRate ? "기초수수료율 상위갯수" : "기초금액 상위갯수",
      calc.upRsvePrceCrtTnum,
    );
    add(
      "inptDt",
      isRate ? "복수예비수수료율 작성일시" : "복수예비가격 작성일시",
      calc.inptDt,
    );
  }
  if (isInterest) {
    add("goalItrt", "목표금리", amount.goalItrt);
  } else if (!isNoPrice) {
    add("pnpr", isRate ? "예정수수료율" : "예정가격", amount.pnpr);
    add("bsamt", isRate ? "기초수수료율" : "기초금액", amount.bsamt);
  }
  if (
    String(pbanc.prcmBsneSeCd ?? "") === "07" &&
    pcsp.isPureConstExpsTrget === "Y" &&
    hasValue(amount.pnprPcsp)
  ) {
    add("pnprPcsp", "예정가격 중 순공사원가", amount.pnprPcsp);
    add("bsamtPcsp", "기초금액 중 순공사원가", pcsp.bsamtPcsp);
  }

  const sections: OpeningResultDisplay["sections"] = [
    { kind: "fields", title: "공고정보", fields },
  ];
  if (isMultiple) {
    const columns = [
      field("plrlRsvePrceSqno1", "구분"),
      field("plrlRsvePrce1", isRate ? "수수료율(%)" : "금액(원)"),
      field("drawNotm1", "추첨횟수"),
      field("plrlRsvePrceSqno2", "구분"),
      field("plrlRsvePrce2", isRate ? "수수료율(%)" : "금액(원)"),
      field("drawNotm2", "추첨횟수"),
    ];
    sections.push({
      kind: "table",
      title: "예비가격정보",
      table: {
        columns,
        rows: displayTableRows(price.rsvePrceList, columns),
      },
    });
  } else if (isNoPrice) {
    sections.push({
      kind: "fields",
      title: "예비가격정보",
      fields: [
        {
          key: "noPrice",
          label: "안내",
          value: "비예가 방식입니다. 데이터가 존재하지 않습니다.",
        },
      ],
    });
  }
  return { status: "", sections };
}
