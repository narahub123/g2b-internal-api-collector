import type { NoticeKey } from "@/entities/notice";
import { noticePostRecord } from "@/entities/notice/model/notice-posts";
import { createG2bSession } from "@/shared/api/g2b/g2b-session";
import { throwIfMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { attachmentGroup } from "@/shared/model/g2b/g2b-attachments";
import { collectAttachments } from "./attachments";
import { postG2b, type G2bRequest } from "./request";

// 통합검색의 BidPbancP 화면에서 민간공고를 여는 분기와 동일한 코드다.
export const privateNoticeBusinessCodes: ReadonlySet<unknown> = new Set(["21", "22", "23", "24"]);

const submissionPrefix = "FIUA027_01_wframe_popupCnts_bidPbancWfrm_";

function searchInput(key: NoticeKey) {
  return {
    bidPbancNo: key.number, bidPbancOrd: key.revision,
    bidClsfNo: "", bidPrgrsOrd: "", bidPbancNm: "", prcmBsneSeCd: "", bidPbancPgstCd: "",
    pbancPstgStDt: "", pbancPstgEdDt: "", recordCountPerPage: "", rowNum: "",
    kbrdrId: "", untyGrpNo: "", flag: "", pbancType: "", odn3ColCn: "",
  };
}

/**
 * 누리장터 공고서 화면의 상세 원본을 익명 세션으로 조회한다.
 * @param key 원본 공고번호와 차수.
 * @throws 세션 발급 실패, 점검 또는 상세 API 오류를 전달한다.
 */
export async function fetchPrivateNotice(key: NoticeKey) {
  const request = await createG2bSession();
  const raw = await postG2b("/nn/nnb/nnba/selectBidPbancDetl.do", submissionPrefix + "selectBidPbancDetl", {
    dlSrchCndtM: searchInput(key),
  }, request);
  return { raw, request };
}

/**
 * 변경·취소 공고의 공지 목록과 공개 본문을 원본 순서대로 수집한다.
 * 최초공고는 공지 영역을 숨기며 개별 본문이 실패해도 확인한 목록을 보존한다.
 * @param status 공고 처리 상태 코드로 공지 조회 조건을 결정한다.
 * @throws 점검 또는 공지 목록 조회 오류를 전달한다.
 */
export async function fetchPrivateNoticePosts(
  key: NoticeKey,
  status: unknown,
  request: G2bRequest,
  recordFailure?: (error: unknown) => void,
) {
  if (key.revision === "000") return undefined;
  const odn3ColCn = status === "공400002" ? "A" : status === "공400003" ? "B" : "";
  const list = await postG2b("/nn/nnb/nnbb/selectBidNoceDetl.do", submissionPrefix + "selectBidNoceDetl", {
    dlSrchCndtM: { ...searchInput(key), flag: "bidDtl", odn3ColCn },
  }, request);
  if (!Array.isArray(list.result?.noceList)) throw new Error("민간공고 공지 목록 응답이 올바르지 않습니다.");
  const entries = await Promise.allSettled(list.result.noceList.map(async (value: unknown) => {
    const row = noticePostRecord(value);
    const { bbsNo, pstNo } = row;
    if (!bbsNo || !pstNo) return undefined;
    // 변경·취소 사유 게시판은 이전 차수에 본문을 저장한다.
    const previous = bbsNo === "R23AB00000108" && (row.odn3ColCn === "A" || row.odn3ColCn === "B");
    const revision = previous ? String(Number(key.revision) - 1).padStart(3, "0") : key.revision;
    const raw = await postG2b("/nn/nnb/nnbb/selectBidNoceBulkPstCn.do",
      submissionPrefix + "NNBB027_01_wframe_popupCnts_sbmSrchNtcPst", {
        dlPstM: { bbsNo, pstNo, bidPbancNo: key.number, bidPbancOrd: revision },
      }, request);
    const group = attachmentGroup(raw.result?.noceMap?.untyAtchFileNo);
    const attachments = group ? await collectAttachments(group, "notice-post", request).catch((error: unknown) => {
      throwIfMaintenance({ status: "rejected", reason: error });
      recordFailure?.(error);
      return undefined;
    }) : undefined;
    return { raw, attachments };
  }));
  throwIfMaintenance(...entries);
  const details = entries.map((entry) => {
    if (entry.status === "fulfilled") return entry.value;
    recordFailure?.(entry.reason);
    return undefined;
  });
  return { list, details };
}

/**
 * 원본 민간 상세 화면과 첨부 UDC가 사용하는 그룹별 공통코드 표시명을 조회한다.
 * @throws 공통코드 요청 또는 응답 형식 오류를 전달한다.
 */
export async function fetchPrivateNoticeCodeNames(request: G2bRequest) {
  const response = await postG2b("/co/cob/coba/CommCd/selectCommCdList.do", "sbm_getCommCodeList", {
    dlCommGrpCdM: { commGrpCd: "계03PN009,공40PN000,공44PN000,낙03PN000,단08PR000,입18NN000,조07NN000,인01PN007,첨02NN005" },
  }, request);
  if (!Array.isArray(response.dlCommCdL)) throw new Error("민간공고 공통코드 응답이 올바르지 않습니다.");
  const codes: Record<string, Record<string, string>> = {};
  for (const value of response.dlCommCdL) {
    const row = noticePostRecord(value);
    if (typeof row.commClsfCd !== "string" || typeof row.bsneClsfNo !== "string" || typeof row.commCd !== "string") continue;
    const group = row.commClsfCd + row.bsneClsfNo;
    if (typeof row.cdNm === "string") (codes[group] ??= {})[row.commCd] = row.cdNm;
    if (typeof row.cdSplmNm === "string") (codes[group + ":supplement"] ??= {})[row.commCd] = row.cdSplmNm;
  }
  return codes;
}
