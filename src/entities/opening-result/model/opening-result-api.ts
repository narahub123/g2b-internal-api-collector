import {
  resolveOpeningResultEndpoint,
  type OpeningResultEndpoint,
  type OpeningResultKey,
  type OpeningResultQuery,
  type OpeningResultNotice,
} from "@/entities/opening-result/model/opening-result";

const prefix = "/pb/pbo/pboc/OnbsRslt/";
const submissionPrefix =
  "FIUA027_01_wframe_popupCnts_bidPbancWfrm_mainWframe_onbsDtlInfo_wframe_popupCnts_";

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sameRevision(value: unknown, expected: string) {
  return (
    /^\d{1,3}$/.test(String(value ?? "")) &&
    String(value).padStart(3, "0") === expected
  );
}

/** API별 입력/출력 차이를 한 곳에서 관리한다. 원본 응답은 가공하지 않고 보존한다. */
export function openingResultRequest(
  key: OpeningResultKey,
  query: OpeningResultQuery,
) {
  if (
    query.number !== key.number ||
    query.revision !== key.revision ||
    query.openingRevision !== key.openingRevision
  ) {
    throw new Error("개찰결과 조회 조건과 공고 식별자가 일치하지 않습니다.");
  }
  const endpoint = resolveOpeningResultEndpoint(query);
  if (!endpoint) throw new Error("지원하지 않는 개찰결과 API 유형입니다.");
  const status = query.status ?? "유찰"; // 기존 저장 자료는 유찰만 존재한다.
  const paged = endpoint !== "selectOnbsRsltFbid";
  return {
    endpoint,
    path: `${prefix}${endpoint}.do`,
    submission: `${submissionPrefix}${endpoint}`,
    input: {
      dlSrchOnbsRsltBidInM: {
        bidPbancNo: key.number,
        bidPbancOrd: key.revision,
        bidClsfNo: query.classification,
        bidPrgrsOrd: key.openingRevision,
        prcmBsneSeCd: query.businessCode,
        bidPgstCd: status,
        bzmnRegNo: "",
        reOpenPbancYN: "",
        ...(paged ? { currentPage: 1, recordCountPerPage: "10" } : {}),
      },
    },
  };
}

/** 요청 식별자를 검증하고 API의 result 원본을 반환한다. */
export function openingResultDetail(
  endpoint: OpeningResultEndpoint,
  response: unknown,
  key: OpeningResultKey,
  query: OpeningResultQuery,
): Record<string, unknown> {
  const result = object(object(response)?.result);
  if (!result) throw new Error(`${endpoint}: result 객체가 없습니다.`);
  if (endpoint === "selectOnbsRsltFbid") {
    const detail = object(result.bidPrgrs);
    if (
      !detail ||
      detail.bidPbancNo !== key.number ||
      !sameRevision(detail.bidPbancOrd, key.revision) ||
      !sameRevision(detail.bidPrgrsOrd, key.openingRevision) ||
      String(detail.bidClsfNo) !== query.classification
    ) {
      throw new Error(`${endpoint}: 요청한 유찰·입찰취소 결과가 아닙니다.`);
    }
    return detail; // 구형 유찰 화면의 detail.prcsRsn 접근을 유지한다.
  }
  if (endpoint === "selectOnbsRsltRbid") {
    const bidPrgrs = object(result.bidPrgrs);
    if (
      !bidPrgrs ||
      !Array.isArray(result.reBidInfo) ||
      bidPrgrs.bidPbancNo !== key.number ||
      !sameRevision(bidPrgrs.bidPbancOrd, key.revision) ||
      !sameRevision(bidPrgrs.bidPrgrsOrd, key.openingRevision) ||
      String(bidPrgrs.bidClsfNo) !== query.classification
    ) {
      throw new Error(`${endpoint}: 요청한 재입찰 결과가 아닙니다.`);
    }
    return result;
  }
  const bidInfo = object(result.bidInfo);
  if (
    !bidInfo ||
    !object(result.etcData) ||
    !Array.isArray(result.successBidInfo) ||
    bidInfo.bidPbancNo !== key.number ||
    !sameRevision(bidInfo.bidPbancOrd, key.revision)
  ) {
    throw new Error(
      `${endpoint}: 개찰완료 결과의 식별자 또는 필수 응답이 올바르지 않습니다.`,
    );
  }
  // 개찰완료 API는 bidInfo에 개찰차수/분류번호가 없을 수 있다.
  // 요청 조건(query)을 결과와 함께 보존하며, 다른 차수로 단정하지 않는다.
  return result;
}

const openingNoticeBoardNo = "R23AB00000204";
const openingNoticePath = "/pn/pnp/pnpe/commBidPbac/selectNtcPstList.do";

/** 원본 JS의 연기공고 및 최종낙찰자 없음 공지사항 요청을 생성한다. */
export function openingResultNoticeRequests(
  key: Pick<OpeningResultKey, "number" | "revision">,
  classifications: string[],
) {
  const base = {
    bbsNo: openingNoticeBoardNo,
    odn1ColCn: key.number,
    odn2ColCn: key.revision,
  };
  return [
    {
      kind: "postponement" as const,
      path: openingNoticePath,
      submission: "sbmSrchNtcPstList",
      input: { dlPstM: { ...base, clsfPritmSqno: "1182" } },
    },
    ...[...new Set(classifications)].map((classification) => ({
      kind: "opening" as const,
      classification,
      path: openingNoticePath,
      submission: "sbmSrchNtcPstList",
      input: {
        dlPstM: {
          ...base,
          clsfPritmSqno: "1727",
          odn3ColCn: classification,
        },
      },
    })),
  ];
}

/** API의 첫 게시글만 사용한다. 원본 JS도 목록의 첫 행만 표시한다. */
export function openingResultNoticeFromResponse(
  response: unknown,
): OpeningResultNotice | null {
  const rows = object(response)?.dlPstL;
  if (!Array.isArray(rows)) {
    throw new Error("개찰결과 공지사항 응답에 dlPstL 배열이 없습니다.");
  }
  if (!rows.length) return null;
  const row = object(rows[0]);
  if (
    !row ||
    typeof row.pstNo !== "string" && typeof row.pstNo !== "number" ||
    typeof row.inptDt !== "string" ||
    typeof row.pstNm !== "string"
  ) {
    throw new Error("개찰결과 공지사항 게시글의 필수 필드가 올바르지 않습니다.");
  }
  return {
    bbsNo: openingNoticeBoardNo,
    pstNo: String(row.pstNo),
    inptDt: row.inptDt,
    pstNm: row.pstNm,
  };
}

/** 원본 JS와 동일하게 연기공고보다 작성일시가 최신인 개찰 공지를 우선한다. */
export function selectOpeningResultNotice(
  postponement: OpeningResultNotice | null,
  opening: OpeningResultNotice | null,
): OpeningResultNotice | null {
  return opening && (!postponement || opening.inptDt > postponement.inptDt)
    ? opening
    : postponement;
}
