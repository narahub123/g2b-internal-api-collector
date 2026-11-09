import {
  resolveOpeningResultEndpoint,
  type OpeningResultEndpoint,
  type OpeningResultQuery,
} from "./opening-result";

type Data = Record<string, unknown>;
export type DisplayField = {
  key: string;
  label: string;
  value: unknown;
  /** 원본 화면의 클릭 가능한 공고번호만 내부 공고 상세로 연결한다. */
  href?: string;
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

// OnbsRsltAllUsrV-2.js의 개찰완료 공고정보 표시 순서.
// 접수 시작/마감일시 및 개찰예정일시는 이 영역의 화면 필드가 아니므로 표시하지 않는다.
const noticeFields = [
  field("bidPbancNoPbancOrd", "입찰공고번호"),
  field("usrDocNoVal", "참조번호"),
  field("realOnbsDt", "실제개찰일시"),
  field("bidPbancNm", "입찰공고명"),
  field("pbancInstUntyGrpNm", "공고기관"),
  field("dmstNm", "수요기관"),
  field("bidBlffNm", "집행관"),
  field("picNm", "공고담당자"),
] as const;

// OnbsRsltAllUsrV-2.js의 각 sBid*Box 공고정보 테이블에 실제로 배치된 필드.
// API 응답에 값이 있더라도 해당 업무 화면에 없는 필드는 노출하지 않는다.
// 용역의 설계공모(isPssrp)는 기본 행을 숨기고 대체 행을 표시하지만,
// 공고기관·수요기관·집행관의 필드 자체는 두 행에 공통으로 존재한다.
const noticeVisibleKeys: Partial<
  Record<OpeningResultEndpoint, readonly string[]>
> = {
  // 물품: 공고담당자까지 표시
  selectOnbsRsltSbidGods: [
    "bidPbancNoPbancOrd",
    "usrDocNoVal",
    "realOnbsDt",
    "bidPbancNm",
    "pbancInstUntyGrpNm",
    "dmstNm",
    "bidBlffNm",
    "picNm",
  ],
  // 용역: 설계공모 여부에 따라 행만 교체하며 공고담당자 필드는 없음
  selectOnbsRsltSbidSrvc: [
    "bidPbancNoPbancOrd",
    "usrDocNoVal",
    "realOnbsDt",
    "bidPbancNm",
    "pbancInstUntyGrpNm",
    "dmstNm",
    "bidBlffNm",
  ],
  // 공사: 공고담당자 필드는 없음
  selectOnbsRsltSbidCstn: [
    "bidPbancNoPbancOrd",
    "usrDocNoVal",
    "realOnbsDt",
    "bidPbancNm",
    "pbancInstUntyGrpNm",
    "dmstNm",
    "bidBlffNm",
  ],
  // 외자: 공고기관·집행관·공고담당자 필드는 없음
  selectOnbsRsltSbidFrcp: [
    "bidPbancNoPbancOrd",
    "usrDocNoVal",
    "realOnbsDt",
    "bidPbancNm",
    "dmstNm",
  ],
  // 리스: 참조번호 필드가 없고, 입찰분류번호는 별도의 화면 항목
  selectOnbsRsltSbidLase: [
    "bidPbancNoPbancOrd",
    "realOnbsDt",
    "bidPbancNm",
    "pbancInstUntyGrpNm",
    "dmstNm",
    "picNm",
    "bidBlffNm",
  ],
  // 비축: 참조번호·기관·담당자 필드가 없고, 입찰분류번호는 별도의 화면 항목
  selectOnbsRsltSbidRsrv: ["bidPbancNoPbancOrd", "realOnbsDt", "bidPbancNm"],
};

/**
 * 공고번호와 차수를 내부 공고 상세 경로로 변환한다.
 * 원본 수집값은 변경하지 않으며 외부 나라장터 URL로 이동하지 않는다.
 * @param number 입찰공고번호.
 * @param revision 입찰공고차수.
 * @returns 내부 공고 상세 경로.
 */
function noticeDetailHref(number: string, revision: string): string {
  return `/notices/${encodeURIComponent(number)}/${encodeURIComponent(revision.padStart(3, "0"))}`;
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

/** 원본 응답의 섹션/필드를 표시 모델로 변환한다. 원본에 없는 안내문은 만들지 않는다. */
export function getOpeningResultDisplay(
  query: OpeningResultQuery,
  detail: Data,
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
      const visibleKeys = noticeVisibleKeys[endpoint] ?? [];
      const fields = selectedFields(
        bidInfo,
        noticeFields.filter(({ key }) => visibleKeys.includes(key)),
      );
      if (
        visibleKeys.includes("bidPbancNoPbancOrd") &&
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
      const number =
        typeof bidInfo.bidPbancNo === "string" && bidInfo.bidPbancNo
          ? bidInfo.bidPbancNo
          : query.number;
      const revision = String(bidInfo.bidPbancOrd ?? query.revision);
      const noticeNumber = fields.find(
        ({ key }) => key === "bidPbancNoPbancOrd",
      );
      if (noticeNumber && number && revision) {
        noticeNumber.href = noticeDetailHref(number, revision);
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
    table: { rows, columns },
  });
  return { status, sections };
}
