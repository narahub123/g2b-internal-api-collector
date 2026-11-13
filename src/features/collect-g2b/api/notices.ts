import { contractRequestKeys } from "@/entities/contract-request/model/contract-request";
import { contractKeys } from "@/entities/contract/model/contract";
import type { Notice, NoticeKey } from "@/entities/notice";
import { etcNoticeBusinessCode, etcNoticeDetail, noticeAttachmentGroup } from "@/entities/notice/model/notice-detail";
import { noticePostRecord, noticePostRows, type NoticePost } from "@/entities/notice/model/notice-posts";
import { getNoticeOrderPlanNumber } from "@/entities/order-plan/model/order-plan";
import { getNoticePriorSpecNumber } from "@/entities/prior-spec/model/prior-spec";
import { createG2bSession } from "@/shared/api/g2b/g2b-session";
import { findMaintenance, throwIfMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { attachmentGroup } from "@/shared/model/g2b/g2b-attachments";
import { postG2b, G2bAccessDenied } from "./request";
import { collectDocumentList, collectAttachments } from "./attachments";
import { fetchWorkProgress } from "./work-progress";
import { collectNoticeOpeningResults, type OpeningCollectionReport } from "./opening-results";
import { collectContractRequest } from "./contract-requests";
import { collectContract } from "./contracts";
import { collectOrderPlan } from "./order-plans";
import { collectPriorSpec } from "./prior-specs";
import { fetchEtcNotice } from "./etc-notice";
import { collectionValidationError } from "@/shared/api/g2b/collection-diagnostic";

// 공고 상세 화면의 submission 식별자 접두사.
const submissionPrefix = "FIUA027_01_wframe_popupCnts_bidPbancWfrm_mainWframe_";

/**
 * 제안요청 상세의 첨부 목록을 세션이 포함된 요청으로 조회한다.
 *
 * @param rfpNo 제안요청 번호.
 * @param rfpOrd 제안요청 차수.
 * @param prcmBsneSeCd 조달 업무 구분 코드.
 * @returns 제안요청 문서 목록을 포함한 원본 응답.
 */
async function collectProposal(
  rfpNo: string,
  rfpOrd: string | number,
  prcmBsneSeCd: string,
) {
  const request = await createG2bSession();
  return collectDocumentList(
    "/pr/prp/prpc/Rfp/selectRfpDtl.do",
    submissionPrefix + "sbmRfp",
    {
      dlRfpM: { rfpNo, rfpOrd, prcmBsneSeCd, ctrtImplPicYn: "Y" },
    },
    request,
  );
}

/**
 * 공고 유형 판별에 사용한 업무 진행 내역에서 연결된 미수집 계약요청·계약 상세를 수집한다.
 * 일반 조회 실패가 있어도 확인된 연결을 반환해 개별 재수집에 사용할 수 있게 한다.
 *
 * @param key 공고번호와 공고차수.
 * @returns 계약요청 및 계약 식별자 목록.
 * @throws 연결된 상세 수집에서 점검을 확인한 경우.
 */
async function collectNoticeContractLinks(key: NoticeKey, rows: Record<string, unknown>[], recordFailure?: (error: unknown) => void) {
  const requests = contractRequestKeys(rows, key);
  const contracts = contractKeys(rows, key);
  const outcomes = await Promise.allSettled([
    ...requests.map((request) => collectContractRequest(request)),
    ...contracts.map((contract) => collectContract(contract)),
  ]);
  throwIfMaintenance(...outcomes);
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") recordFailure?.(outcome.reason);
  }
  return { contractRequests: requests, contracts };
}

/**
 * 공고의 공지 목록과 각 게시글의 상세·본문·첨부 응답을 수집한다.
 * 게시글의 일반 오류는 허용하되 점검을 확인하면 다음 게시글을 조회하지 않는다.
 * @throws 공지 목록 조회가 실패하거나 목록 또는 개별 게시글 조회에서 점검을 확인한 경우.
 */
async function collectNoticePosts(key: NoticeKey, recordFailure?: (error: unknown) => void): Promise<NonNullable<Notice["posts"]>> {
  const prefix = "FIUA027_01_wframe_popupCnts_bidPbancWfrm_";
  const popupPrefix = prefix + "PNPE031_01_wframe_popupCnts_";
  const popupMenu = '{"menuNo":"12568","menuCangVal":"PNPE031_01","bsneClsfCd":"%EC%97%85130026","scrnNo":"07883"}';
  const list = await postG2b(
    "/pn/pnp/pnpe/commBidPbac/selectNtcPstList.do",
    prefix + "sbmSrchNtcPstList",
    { dlPstM: { odn1ColCn: key.number, odn2ColCn: key.revision } },
  );
  const entries: NoticePost[] = [];
  const rows = noticePostRows(list);
  // 목록은 공개 요청으로 조회되지만 게시글 상세 API는 익명 세션을 요구한다.
  const request = rows.length ? createG2bSession() : undefined;
  for (const { bbsNo, pstNo } of rows) {
    const entry: NoticePost = { bbsNo, pstNo };
    entries.push(entry);
    try {
      const session = await request;
      const detail = await postG2b(
        "/fm/fma/fmaa/Pst/selectPst.do", popupPrefix + "sbmSrchNtcPst",
        { dlPstM: {
          bbsNo, pstNo, pstNm: "", bbsClsfPritmNm: "", inptEdDt: "", inptStDt: "",
          clsfPritmSqno: "", untyAtchFileNo: "", pstRlsYn: "", tmprStrgYn: "",
          kbrdrId: "", odn1ColCn: "", odn2ColCn: "", odn3ColCn: "", pstTy: "",
          ntcBgngDt: "", ntcEndDt: "", popupBgngDt: "", popupEndDt: "", atrzNo: "",
          atrzSttsCd: "", prslAuthrtUsrTyCd: "", inptDt: "", chgDt: "",
        } }, session, popupMenu,
      );
      const metadata = noticePostRecord(detail.dlPstM);
      if (metadata.bbsNo !== bbsNo || String(metadata.pstNo) !== pstNo)
        throw collectionValidationError("공지사항 상세 키가 일치하지 않습니다.", "dlPstM",
          { number: bbsNo, revision: pstNo }, { number: metadata.bbsNo, revision: metadata.pstNo });
      entry.detail = detail;
      const group = attachmentGroup(metadata.untyAtchFileNo);
      const [body, attachments] = await Promise.allSettled([
        postG2b(
          "/fm/fma/fmaa/PstCn/selectPstCn.do", popupPrefix + "sbmSrchNtcPstDtl",
          { dlPstCnM: { pstNo, bbsNo, bulkPstCn: "" } }, session, popupMenu,
        ).then((response) => {
          const data = noticePostRecord(response.dlPstCnM);
          if (data.bbsNo !== bbsNo || String(data.pstNo) !== pstNo)
            throw collectionValidationError("공지사항 본문 키가 일치하지 않습니다.", "dlPstCnM",
              { number: bbsNo, revision: pstNo }, { number: data.bbsNo, revision: data.pstNo });
          return response;
        }),
        group ? collectAttachments(group, "notice-post") : undefined,
      ]);
      throwIfMaintenance(body, attachments);
      if (body.status === "fulfilled") entry.body = body.value;
      else recordFailure?.(body.reason);
      if (attachments.status === "fulfilled") entry.attachments = attachments.value;
      else recordFailure?.(attachments.reason);
    } catch (error) {
      const maintenance = findMaintenance(error);
      if (maintenance) throw maintenance;
      // 일반 상세 오류에서는 목록의 게시글 식별자를 보존하고 다음 게시글을 조회한다.
      recordFailure?.(error);
    }
  }
  return { list, entries };
}

/**
 * 업무 진행 내역으로 상세 API를 선택하고 상세, 문서와 계약 연결을 수집한다.
 * 일반 공고는 공지사항, 발주계획, 사전규격과 개찰결과도 수집한다.
 * 일반 부가 조회 오류는 허용하며, 점검을 확인하면 공고 행을 저장할 호출자에게 오류를 전달한다.
 * 독립적으로 완료된 관련 자료는 저장될 수 있다.
 * @param key 공고번호와 차수.
 * @param methodCode 상세 조회에 전달하는 낙찰방법 코드.
 * @param recordFailure 본문 저장을 계속할 수 있는 부가 조회 실패를 이력에 남기는 콜백.
 * @returns 저장할 공고 원본과 이번 요청에서 처리한 개찰차수별 결과.
 * @throws 공고 상세 조회 또는 식별자 검증에 실패하거나 상세·부가 조회에서 점검을 확인한 경우.
 */
export async function collectNotice(
  key: NoticeKey,
  methodCode: string,
  recordFailure?: (error: unknown) => void,
): Promise<{ notice: Notice; openingReport: OpeningCollectionReport }> {
  const collectedAt = new Date().toISOString();
  const workProgress = await fetchWorkProgress(key).catch((error) => {
    const maintenance = findMaintenance(error);
    if (maintenance) throw maintenance;
    // 일반 오류에서는 업무구분을 알 수 없어 기존 상세 조회를 시도한다.
    recordFailure?.(error);
    return undefined;
  });
  const isEtc = workProgress?.some((row) => row?.prcmBsneSeCd === etcNoticeBusinessCode);
  const payload = isEtc ? await fetchEtcNotice(key) : await postG2b(
    "/pn/pnp/pnpe/ItemBidPbac/selectItemAnncMngV.do",
    submissionPrefix + "selectItemAnncMngV",
    {
      dmItemMap: {
        bidPbancNo: key.number,
        bidPbancOrd: key.revision,
        scsbdMthdCd: methodCode,
        currentPage: 1,
      },
    },
  );
  const detail = isEtc ? etcNoticeDetail(payload) : payload.dmItemMap;
  // 기타 상세의 별도 BM 번호는 BK 번호로 요청한 공고의 저장 키와 다르다.
  const number = isEtc ? detail?.bidPbancUntyNo : detail?.bidPbancNo;
  const revision = isEtc ? detail?.bidPbancUntyOrd : detail?.bidPbancOrd;
  if (
    number !== key.number ||
    !/^\d{1,3}$/.test(String(revision)) ||
    String(revision).padStart(3, "0") !== key.revision ||
    (isEtc && detail?.prcmBsneSeCd !== etcNoticeBusinessCode) ||
    typeof detail?.bidPbancNm !== "string" ||
    !detail.bidPbancNm.trim()
  ) {
    const detailField = isEtc ? "dlUntyBidPbancM" : "dmItemMap";
    const field = typeof detail?.bidPbancNm !== "string" || !detail.bidPbancNm.trim()
      ? `${detailField}.bidPbancNm` : detailField;
    throw collectionValidationError("요청한 공고의 상세 응답을 받지 못했습니다.", field, key, { number, revision });
  }
  // 첨부 목록은 공고의 첨부 그룹만 조회하고, 제안요청은 상세 JS와 같이 협상계약에만 적용한다.
  const orderPlanLookupNumber = isEtc ? undefined : getNoticeOrderPlanNumber(payload);
  const priorSpecNumber = isEtc ? undefined : getNoticePriorSpecNumber(payload);
  const group = isEtc ? noticeAttachmentGroup(payload) : detail.itemPbancUntyAtchFileNo?.trim();
  const linkedRows = isEtc ? workProgress?.map((row) => {
    // 기타 업무진행 행은 BK 번호 없이 상세의 BM 번호만 반환할 수 있다.
    if (row && !row.bidPbancNo && typeof detail.untyBidPbancNo === "string" &&
        detail.untyBidPbancNo && row.untyBidPbancNo === detail.untyBidPbancNo &&
        /^\d{1,3}$/.test(String(row.untyBidPbancOrd)) &&
        String(row.untyBidPbancOrd).padStart(3, "0") === String(detail.untyBidPbancOrd).padStart(3, "0")) {
      return { ...row, bidPbancNo: key.number, bidPbancOrd: key.revision };
    }
    return row;
  }) : workProgress;
  // 일반 부가 조회 오류는 공고 저장을 허용하지만, 점검이 하나라도 확인되면 공고 저장을 보류한다.
  const outcomes = await Promise.allSettled([
    group
      ? collectAttachments(group, isEtc ? "etc-notice" : "notice")
      : undefined,
    !isEtc && detail.scsbdMthdCd === "낙030005" &&
    detail.rfpNo?.trim() &&
    /^\d{1,3}$/.test(String(detail.rfpOrd))
      ? collectProposal(detail.rfpNo, detail.rfpOrd, detail.prcmBsneSeCd)
      : undefined,
    linkedRows ? collectNoticeContractLinks(key, linkedRows, recordFailure) : undefined,
    isEtc ? { targetRevisions: [], succeededRevisions: [], failures: [] } : collectNoticeOpeningResults(payload),
    isEtc ? undefined : collectNoticePosts(key, recordFailure),
    orderPlanLookupNumber ? collectOrderPlan(orderPlanLookupNumber, false, { fromNotice: true }) : undefined,
    priorSpecNumber ? collectPriorSpec(priorSpecNumber) : undefined,
  ]);
  const [attachments, proposal, contractLinks, openingResults, posts, orderPlan] = outcomes;
  const collectedOrderPlan = orderPlan.status === "fulfilled" ? orderPlan.value : undefined;
  if (recordFailure) {
    if (collectedOrderPlan?.attachmentFailure) recordFailure(collectedOrderPlan.attachmentFailure.reason);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected" && !findMaintenance(outcome.reason)) recordFailure(outcome.reason);
    }
  }
  if (openingResults.status === "rejected") throw openingResults.reason;
  const openingReport = openingResults.value;
  try {
    throwIfMaintenance(...outcomes, ...openingReport.failures.map(({ error }) => ({
      status: "rejected", reason: error,
    })));
  } catch (error) {
    throw new NoticeCollectionDeferred(openingReport, error);
  }
  if (openingReport.failures.length) {
    console.error("개찰결과 수집 실패:", openingReport.failures);
    for (const { error } of openingReport.failures) recordFailure?.(error);
  }
  // 문서 조회 오류가 공고 상세와 다른 문서의 저장을 막지 않도록 실패 종류를 따로 기록한다.
  const documents: NonNullable<Notice["documents"]> = {
    attachments:
      attachments.status === "fulfilled" ? attachments.value : undefined,
    proposal: proposal.status === "fulfilled" ? proposal.value : undefined,
    unavailable: [],
  };
  if (attachments.status === "rejected")
    documents.unavailable?.push("attachments");
  if (proposal.status === "rejected") {
    documents.unavailable?.push("proposal");
    if (proposal.reason instanceof G2bAccessDenied)
      documents.proposalAccessDenied = true;
  }

  return {
    openingReport,
    notice: {
      ...key,
      title: detail.bidPbancNm,
      collectedAt,
      payload,
      orderPlanNumber: collectedOrderPlan?.number,
      posts: posts.status === "fulfilled" ? posts.value : undefined,
      documents,
      ...(contractLinks.status === "fulfilled" ? contractLinks.value : {}),
    },
  };
}

/** 점검으로 공고 저장을 보류할 때 이미 확인한 개찰 결과를 전달한다. */
export class NoticeCollectionDeferred extends Error {
  constructor(readonly openingReport: OpeningCollectionReport, cause: unknown) {
    super("나라장터 점검으로 공고 저장을 보류했습니다.", { cause });
  }
}
