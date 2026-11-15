import type { OpeningResultQuery, QualificationReview } from "@/entities/opening-result/model/opening-result";
import { collectionValidationError } from "@/shared/api/g2b/collection-diagnostic";
import { postG2b, type G2bRequest } from "./request";

const path = "/eb/ebe/ebek/ElgbSrng/";
const menu = '{"menuNo":"01408","menuCangVal":"EBEK007_01","bsneClsfCd":"%EC%97%85130032","scrnNo":"04563"}';
const submission = "FIUA027_01_wframe_popupCnts_onbsRsltWfrm_QlemRsltJdgmntL_wframe_popupCnts_";

// WebSquare 데이터맵에 선언된 키만 두 번째 요청에 포함하며 미바인딩 키는 빈 문자열로 전송한다.
const bidMapKeys = [
  "bidPbancNo", "bidPbancOrd", "bidClsfNo", "bidPrgrsOrd", "bidPbancNoOrd",
  "qlemTrgtNtfctnOrd", "onbsPrnmntDt", "prcmBsneSeCd", "prcmBsneSeNm",
  "bidPbancNm", "engPbancNm", "pbancPstgYmd", "slprRcptDdlnYmd",
  "pbancGrpNm", "dmstGrpNm", "sedrUsrNm", "sedrBaseTlphNo", "prspPrce",
  "lcrtTyCd", "lcrtTyCdNm", "crtrNm", "srngDtlsCrtr", "edocNo", "qlemDmndTermDt",
  "scsbdSrngCrtrNo", "scsbdSrngCrtrRvsnOrd", "scsbdSrngDtlsCrtrSqno",
  "srngMaagSeCd", "prcmMthoSeCd", "pbancInstUntyGrpNo", "dmstUntyGrpNo",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matchesIdentity(value: unknown, query: OpeningResultQuery): value is Record<string, unknown> {
  const revision = (raw: unknown) => {
    const text = String(raw ?? "");
    return /^\d{1,3}$/.test(text) ? text.padStart(3, "0") : undefined;
  };
  return isRecord(value) &&
    value.bidPbancNo === query.number &&
    revision(value.bidPbancOrd) === query.revision &&
    revision(value.bidPrgrsOrd) === query.openingRevision &&
    String(value.bidClsfNo ?? "") === query.classification;
}

/**
 * 익명 세션에서 공고 상세를 먼저 조회한 뒤 같은 분류의 판정 목록을 조회한다.
 * @param query 공고번호·공고차수·개찰차수·입찰분류가 확정된 조회 조건.
 * @param request 두 요청에 공유할 나라장터 세션 함수.
 * @returns 검증된 원본 응답 쌍 또는 조회 불가·0건을 나타내는 null.
 * @throws 요청·점검·업무 응답 오류 또는 응답 구조와 식별자가 맞지 않는 경우.
 */
export async function fetchQualificationReview(
  query: OpeningResultQuery,
  request: G2bRequest,
): Promise<QualificationReview | null> {
  const dlParamM = {
    bidPbancNo: query.number,
    bidPbancOrd: query.revision,
    bidClsfNo: query.classification,
    bidPrgrsOrd: query.openingRevision,
    openYn: "", rsltReptTyCd: "", prcmEtpsYn: "", bzmnRegNo: "",
  };
  const bidResponse: unknown = await postG2b(path + "selectBidInfo.do", submission + "selectBidInfo", { dlParamM }, request, menu);
  if (!isRecord(bidResponse) || !matchesIdentity(bidResponse.bidPbanc, query)) {
    throw collectionValidationError("적격심사 공고 식별자가 일치하지 않습니다.", "bidPbanc", query);
  }
  const bidPbanc = bidResponse.bidPbanc;
  const dlBidPbancM = Object.fromEntries(bidMapKeys.map((key) => [key, bidPbanc[key] ?? ""]));
  const judgmentResponse: unknown = await postG2b(
    path + "selectQlemRsltJdgmntList.do",
    submission + "selectElgbSrngRsltjgmntList",
    { dlParamM, dlBidPbancM },
    request,
    menu,
  );
  const selection = isRecord(judgmentResponse) && judgmentResponse.dlSelectYnM;
  if (isRecord(selection) && selection.selectYn === "N") return null;
  if (!isRecord(judgmentResponse) || !isRecord(selection) || selection.selectYn !== "Y" ||
    !Array.isArray(judgmentResponse.qlemRsltJdgmntList)) {
    throw collectionValidationError("적격심사 판정 목록 형식이 올바르지 않습니다.", "qlemRsltJdgmntList", query);
  }
  const rows: unknown[] = judgmentResponse.qlemRsltJdgmntList;
  if (!rows.every((row) => matchesIdentity(row, query))) {
    throw collectionValidationError("적격심사 판정 목록의 식별자가 일치하지 않습니다.", "qlemRsltJdgmntList", query);
  }
  return rows.length ? {
    bidResponse: { ...bidResponse, bidPbanc },
    judgmentResponse: { ...judgmentResponse, qlemRsltJdgmntList: rows },
  } : null;
}
