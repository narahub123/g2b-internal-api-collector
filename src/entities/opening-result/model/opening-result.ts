import { g2bNumber } from "@/shared/model/g2b-number";

export type OpeningResultKey = {
  number: string;
  revision: string;
  openingRevision: string;
};
export type OpeningResultStatus = "유찰" | "입찰취소" | "재입찰" | "개찰완료";
export type OpeningResultEndpoint =
  | "selectOnbsRsltFbid"
  | "selectOnbsRsltRbid"
  | "selectOnbsRsltSbidGods"
  | "selectOnbsRsltSbidSrvc"
  | "selectOnbsRsltSbidCstn"
  | "selectOnbsRsltSbidFrcp"
  | "selectOnbsRsltSbidLase"
  | "selectOnbsRsltSbidRsrv";

// status/endpoint는 이전에 저장된 유찰 query에는 없으므로 선택 필드로 둔다.
export type OpeningResultQuery = OpeningResultKey & {
  classification: string;
  businessCode: string;
  status?: OpeningResultStatus;
  endpoint?: OpeningResultEndpoint;
};

/** 개찰결과 화면 상단에 표시하는 공지사항 게시글. */
export type OpeningResultNotice = {
  bbsNo: string;
  pstNo: string;
  inptDt: string;
  pstNm: string;
};

export type OpeningResult = OpeningResultKey & {
  collectedAt: string;
  // 기존 유찰 저장 자료의 { query, detail } 형태는 유지한다.
  results: { query: OpeningResultQuery; detail: Record<string, unknown> }[];
  // undefined: 미조회, null: 조회 완료·공지 없음, 객체: 표시할 공지
  notice?: OpeningResultNotice | null;
};

const statusByCode: Record<string, OpeningResultStatus> = {
  입160004: "개찰완료",
  입160010: "개찰완료",
  입160005: "유찰",
  입160006: "재입찰",
  입160012: "입찰취소",
};

function revision(value: unknown) {
  const text = String(value ?? "");
  return /^\d{1,3}$/.test(text) ? text.padStart(3, "0") : undefined;
}

/** 원본 개찰결과 JS의 fnInitView 분기에 대응하는 API를 선택한다. */
export function openingResultEndpoint(
  status: OpeningResultStatus,
  businessCode: string,
): OpeningResultEndpoint | undefined {
  if (status === "유찰" || status === "입찰취소") return "selectOnbsRsltFbid";
  if (status === "재입찰") return "selectOnbsRsltRbid";
  if (businessCode === "01" || businessCode === "03")
    return "selectOnbsRsltSbidGods";
  if (businessCode === "05") return "selectOnbsRsltSbidSrvc";
  if (businessCode === "07") return "selectOnbsRsltSbidCstn";
  if (businessCode === "02" || businessCode === "2" || businessCode === "04")
    return "selectOnbsRsltSbidFrcp";
  if (businessCode === "10" || businessCode === "11" || businessCode === "14")
    return "selectOnbsRsltSbidLase";
  if (businessCode === "12" || businessCode === "13")
    return "selectOnbsRsltSbidRsrv";
  return undefined;
}

/** 저장된 구형 유찰 query를 포함해 조회 API를 판정한다. */
export function resolveOpeningResultEndpoint(
  query: OpeningResultQuery,
): OpeningResultEndpoint | undefined {
  if (query.status)
    return openingResultEndpoint(query.status, query.businessCode);
  // 구형 데이터에는 status가 없으며 기존 모델은 유찰만 저장했다.
  return query.endpoint ?? "selectOnbsRsltFbid";
}

/** 입찰진행현황 한 행에서 조회 가능한 개찰결과 조건을 추출한다. */
export function openingResultQuery(
  row: Record<string, unknown>,
  notice: Record<string, unknown>,
): OpeningResultQuery | undefined {
  if (row.bidClsfYn === "Y") return;
  const status =
    typeof row.bidPgstCd === "string" ? statusByCode[row.bidPgstCd] : undefined;
  // 코드가 존재하는데 미지원이면 상태명으로 임의 대체하지 않는다.
  const resolvedStatus =
    status ??
    (row.bidPgstCd == null && row.bidPgstNm === "유찰" ? "유찰" : undefined);
  if (!resolvedStatus) return;

  const number = g2bNumber(row.bidPbancNo);
  const noticeRevision = revision(row.bidPbancOrd);
  const openingRevision = revision(row.bidPrgrsOrd);
  const classification = String(row.bidClsfNo ?? "");
  const businessCode = String(notice.prcmBsneSeCd ?? "");
  if (
    !number ||
    number !== notice.bidPbancNo ||
    !noticeRevision ||
    noticeRevision !== revision(notice.bidPbancOrd) ||
    !openingRevision ||
    !/^\d+$/.test(classification) ||
    !/^\d{1,2}$/.test(businessCode)
  )
    return;
  const endpoint = openingResultEndpoint(resolvedStatus, businessCode);
  if (!endpoint) return;
  return {
    number,
    revision: noticeRevision,
    openingRevision,
    classification,
    businessCode,
    status: resolvedStatus,
    endpoint,
  };
}

/** 개찰차수 및 분류 기준으로 중복을 제거한 조회 조건. */
export function openingResultQueries(payload: Record<string, unknown>) {
  const notice = payload.dmItemMap as Record<string, unknown> | undefined;
  const rows = payload.dlBidBasePgstL;
  const queries = new Map<string, OpeningResultQuery>();
  if (!notice || !Array.isArray(rows)) return [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const query = openingResultQuery(row as Record<string, unknown>, notice);
    if (query)
      queries.set(`${query.openingRevision}/${query.classification}`, query);
  }
  return [...queries.values()];
}

/** 개찰차수별로 조회 조건을 묶는다. */
export function groupOpeningResultQueries(queries: OpeningResultQuery[]) {
  const groups = new Map<string, OpeningResultQuery[]>();
  for (const query of queries) {
    const group = groups.get(query.openingRevision);
    if (group) group.push(query);
    else groups.set(query.openingRevision, [query]);
  }
  return groups;
}

/** 앱의 개찰결과 상세 경로. */
export function openingResultPath({
  number,
  revision,
}: Pick<OpeningResultKey, "number" | "revision">) {
  return `/opening-results/${encodeURIComponent(number)}/${encodeURIComponent(revision)}`;
}
