import type { NoticeKey } from "@/entities/notice";
import { noticePostRecord } from "@/entities/notice/model/notice-posts";
import { collectionValidationError } from "@/shared/api/g2b/collection-diagnostic";
import { postG2b, type G2bRequest } from "./request";

// 기초금액 화면에서 사용하는 요청 식별자. 공고 상세와 메뉴가 다르다.
export const baseAmountMenu = '{"menuNo":"10330","menuCangVal":"PPPB009_01","bsneClsfCd":"%EC%97%85130027","scrnNo":"06289"}';
export const baseAmountSubmissionPrefix = "mf_wfm_container_mainWframe_selectBsisAmtInqyList_wframe_popupCnts_";

/**
 * 공고 차수에 공개된 기초금액 상세 원본을 조회한다.
 * @param key 요청 공고번호와 세 자리 차수.
 * @param request 익명 세션 요청 함수.
 * @throws 통신·점검·업무 오류가 발생하거나 상세·목록의 구조 또는 공고 식별자가 잘못된 경우.
 */
export async function fetchBaseAmountDetail(key: NoticeKey, request: G2bRequest): Promise<Record<string, unknown>> {
  const raw = await postG2b(
    "/pp/ppp/pppb/bsisAmtDetlInqy/selectBaseAmtDtlPopup.do",
    baseAmountSubmissionPrefix + "sbmSrch",
    { dlBsisAmtM: { bidPbancNo: key.number, bidPbancOrd: key.revision, sign: "", sign2: "", sign3: "" } },
    request,
    baseAmountMenu,
  );
  const result = noticePostRecord(raw.result);
  const bidInfo = noticePostRecord(result.bidInfo);
  const baseEstiPrice = noticePostRecord(result.baseEstiPrice);
  const matchesNotice = (record: Record<string, unknown>) => {
    const revision = String(record.bidPbancOrd);
    return record.bidPbancNo === key.number && /^\d{1,3}$/.test(revision) &&
      revision.padStart(3, "0") === key.revision;
  };
  if (!matchesNotice(bidInfo) ||
    (("bidPbancNo" in baseEstiPrice || "bidPbancOrd" in baseEstiPrice) && !matchesNotice(baseEstiPrice))) {
    throw collectionValidationError("기초금액 상세의 공고 식별자가 일치하지 않습니다.", "result.bidInfo",
      key, { number: bidInfo.bidPbancNo, revision: bidInfo.bidPbancOrd });
  }
  if (!Array.isArray(result.listBaseEstiPrice) || result.listBaseEstiPrice.some((value) => {
    const row = noticePostRecord(value);
    return !Object.keys(row).length || (("bidPbancNo" in row || "bidPbancOrd" in row) && !matchesNotice(row));
  })) {
    throw collectionValidationError("기초금액 목록 형식 또는 공고 식별자가 올바르지 않습니다.", "result.listBaseEstiPrice", key);
  }
  return raw;
}
