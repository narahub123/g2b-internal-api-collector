import {
  resolveOpeningResultEndpoint,
  type OpeningResultEndpoint,
  type OpeningResultKey,
  type OpeningResultQuery,
  type OpeningResultNotice,
  type OpeningResultPrice,
} from "@/entities/opening-result/model/opening-result";

const prefix = "/pb/pbo/pboc/OnbsRslt/";
const submissionPrefix =
  "FIUA027_01_wframe_popupCnts_bidPbancWfrm_mainWframe_onbsDtlInfo_wframe_popupCnts_";

/** API 응답에서 객체 형태만 허용해 이후 필드 검증의 기준을 통일한다. */
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** API의 숫자형 차수 표기(1~3자리)를 3자리 공고 차수와 비교한다. */
function sameRevision(value: unknown, expected: string) {
  return (
    /^\d{1,3}$/.test(String(value ?? "")) &&
    String(value).padStart(3, "0") === expected
  );
}

/**
 * 조회 조건과 공고 식별자의 일치를 확인한 뒤 업무 유형별 상세 조회 요청을 구성한다.
 * 지원하지 않는 유형이나 식별자 불일치는 다른 공고의 데이터가 연결되지 않도록 오류로 처리한다.
 * @param key 조회 대상 공고·공고차수·개찰차수 식별자.
 * @param query 화면에서 선택한 개찰결과 조회 조건.
 * @returns API 경로, 제출 식별자 및 요청 입력 데이터.
 * @throws 조회 조건 불일치 또는 미지원 API 유형.
 */
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
  // 유찰·입찰취소 조회만 페이지 입력 없이 호출하며 나머지 유형은 첫 페이지를 요청한다.
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

/**
 * 개찰 상태별 응답 구조와 공고 식별자를 검증해 상세 데이터를 반환한다.
 * 유찰·입찰취소는 사유 객체, 재입찰과 개찰완료는 목록을 포함한 응답을 유지한다.
 * @param endpoint 호출한 개찰결과 API 유형.
 * @param response API 원본 응답.
 * @param key 조회 대상 공고 식별자.
 * @param query 조회 시 사용한 분류 등 조건.
 * @returns 상태별 화면이 소비하는 검증된 상세 데이터.
 * @throws 필수 응답 누락 또는 요청 식별자 불일치.
 */
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

/**
 * 공고 단위 연기공고와 분류별 개찰 공지 조회 요청을 구성한다.
 * 분류번호를 중복 제거해 동일 공지 조회를 반복하지 않는다.
 * @param key 공고번호 및 공고차수.
 * @param classifications 조회할 입찰분류번호 목록.
 * @returns 연기공고 1건과 고유 분류별 개찰 공지 요청.
 */
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

/**
 * 공지사항 목록 응답에서 화면에 사용할 첫 게시글을 추출한다.
 * 빈 목록은 공지가 없는 정상 상태로 처리하고, 목록 구조나 필수 값 오류는 구분한다.
 * @param response 공지사항 조회 API 응답.
 * @returns 첫 게시글 또는 게시글이 없을 때 null.
 * @throws 목록 형식 또는 첫 게시글의 필수 필드 오류.
 */
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
    (typeof row.pstNo !== "string" && typeof row.pstNo !== "number") ||
    typeof row.inptDt !== "string" ||
    typeof row.pstNm !== "string"
  ) {
    throw new Error(
      "개찰결과 공지사항 게시글의 필수 필드가 올바르지 않습니다.",
    );
  }
  return {
    bbsNo: openingNoticeBoardNo,
    pstNo: String(row.pstNo),
    inptDt: row.inptDt,
    pstNm: row.pstNm,
  };
}

/**
 * 연기공고와 개찰 공지 중 화면에 표시할 한 건을 선택한다.
 * 개찰 공지가 연기공고보다 최신일 때만 개찰 공지를 우선한다.
 * @param postponement 연기공고.
 * @param opening 개찰 공지.
 * @returns 우선순위에 따라 선택한 공지 또는 null.
 */
export function selectOpeningResultNotice(
  postponement: OpeningResultNotice | null,
  opening: OpeningResultNotice | null,
): OpeningResultNotice | null {
  return opening && (!postponement || opening.inptDt > postponement.inptDt)
    ? opening
    : postponement;
}

/**
 * 공고정보의 복수예비가격 및 예정가격 필드에 연결할 상세 조회 요청을 구성한다.
 * 개찰차수까지 일치하는지 확인해 다른 개찰결과의 가격 정보가 섞이지 않게 한다.
 * @param key 조회 대상 공고 식별자.
 * @param query 가격 정보에 대응하는 조회 조건.
 * @returns 가격 정보 API 경로, 제출 식별자 및 입력 데이터.
 * @throws 조회 조건과 공고 식별자가 일치하지 않을 때.
 */
export function openingResultPriceRequest(
  key: OpeningResultKey,
  query: OpeningResultQuery,
) {
  if (
    query.number !== key.number ||
    query.revision !== key.revision ||
    query.openingRevision !== key.openingRevision
  ) {
    throw new Error("예정가격 조회 조건과 공고 식별자가 일치하지 않습니다.");
  }
  return {
    path: `${prefix}selectRsvePrceInfo.do`,
    submission: `${submissionPrefix}RsvePrceCmpuRsltPL_wframe_popupCnts_selectRsvePrceInfo`,
    input: {
      dlSrchPbancInfoInM: {
        bidPbancNo: key.number,
        bidPbancOrd: key.revision,
        bidClsfNo: query.classification,
        bidPrgrsOrd: key.openingRevision,
        prcmBsneSeCd: query.businessCode,
        blffVrfcYn: "",
      },
    },
  };
}

/**
 * 복수예비가격 및 예정가격 응답의 식별자·목록·선택 객체 형식을 검증한다.
 * 가격 관련 선택 객체의 null과 빈 예비가격 목록은 정상 응답으로 유지한다.
 * @param response 가격 정보 API 원본 응답.
 * @param key 조회 대상 공고 식별자.
 * @param query 가격 정보 조회 조건.
 * @returns 화면 표시 모델에 전달할 가격 정보 묶음.
 * @throws 필수 응답 형식이나 식별자가 올바르지 않을 때.
 */
export function openingResultPriceFromResponse(
  response: unknown,
  key: OpeningResultKey,
  query: OpeningResultQuery,
): OpeningResultPrice {
  const data = object(response);
  const pbancInfo = object(data?.pbancInfo);
  const rsvePrceList = data?.rsvePrceList;
  if (
    !pbancInfo ||
    !Array.isArray(rsvePrceList) ||
    !rsvePrceList.every((row) => object(row)) ||
    pbancInfo.bidPbancNo !== key.number ||
    !sameRevision(pbancInfo.bidPbancOrd, key.revision) ||
    !sameRevision(pbancInfo.bidPrgrsOrd, key.openingRevision) ||
    String(pbancInfo.bidClsfNo) !== query.classification
  ) {
    throw new Error(
      "복수예비가격 및 예정가격 응답의 식별자 또는 목록이 올바르지 않습니다.",
    );
  }
  for (const field of [
    "bsisAmtInfo",
    "pcspInfo",
    "plrlRsvePrceCalcInfo",
  ] as const) {
    if (data?.[field] != null && !object(data[field])) {
      throw new Error(
        `복수예비가격 및 예정가격 응답의 ${field} 형식이 올바르지 않습니다.`,
      );
    }
  }
  return {
    pbancInfo,
    bsisAmtInfo: object(data?.bsisAmtInfo) ?? null,
    pcspInfo: object(data?.pcspInfo) ?? null,
    plrlRsvePrceCalcInfo: object(data?.plrlRsvePrceCalcInfo) ?? null,
    rsvePrceList: rsvePrceList as Record<string, unknown>[],
  };
}
