import { contractRequestKeys } from "@/entities/contract-request/model/contract-request";
import { contractKeys } from "@/entities/contract/model/contract";
import type { Notice, NoticeKey } from "@/entities/notice";
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
 * 공고 업무 진행 내역에서 연결된 미수집 계약요청·계약 상세를 수집한다.
 * 일반 조회 실패가 있어도 확인된 연결을 반환해 개별 재수집에 사용할 수 있게 한다.
 *
 * @param key 공고번호와 공고차수.
 * @returns 계약요청 및 계약 식별자 목록.
 * @throws 업무 진행 내역을 조회할 수 없거나 연결된 상세 수집에서 점검을 확인한 경우.
 */
async function collectNoticeContractLinks(key: NoticeKey) {
  const rows = await fetchWorkProgress(key);
  const requests = contractRequestKeys(rows, key);
  const contracts = contractKeys(rows, key);
  const outcomes = await Promise.allSettled([
    ...requests.map((request) => collectContractRequest(request)),
    ...contracts.map((contract) => collectContract(contract)),
  ]);
  throwIfMaintenance(...outcomes);
  return { contractRequests: requests, contracts };
}

/**
 * 공고의 공지 목록과 각 게시글의 상세·본문·첨부 응답을 수집한다.
 * 게시글의 일반 오류는 허용하되 점검을 확인하면 다음 게시글을 조회하지 않는다.
 * @throws 공지 목록 조회가 실패하거나 목록 또는 개별 게시글 조회에서 점검을 확인한 경우.
 */
async function collectNoticePosts(key: NoticeKey): Promise<NonNullable<Notice["posts"]>> {
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
        throw new Error("공지사항 상세 키가 일치하지 않습니다.");
      entry.detail = detail;
      const group = attachmentGroup(metadata.untyAtchFileNo);
      const [body, attachments] = await Promise.allSettled([
        postG2b(
          "/fm/fma/fmaa/PstCn/selectPstCn.do", popupPrefix + "sbmSrchNtcPstDtl",
          { dlPstCnM: { pstNo, bbsNo, bulkPstCn: "" } }, session, popupMenu,
        ).then((response) => {
          const data = noticePostRecord(response.dlPstCnM);
          if (data.bbsNo !== bbsNo || String(data.pstNo) !== pstNo)
            throw new Error("공지사항 본문 키가 일치하지 않습니다.");
          return response;
        }),
        group ? collectAttachments(group, "notice-post") : undefined,
      ]);
      throwIfMaintenance(body, attachments);
      if (body.status === "fulfilled") entry.body = body.value;
      if (attachments.status === "fulfilled") entry.attachments = attachments.value;
    } catch (error) {
      const maintenance = findMaintenance(error);
      if (maintenance) throw maintenance;
      // 일반 상세 오류에서는 목록의 게시글 식별자를 보존하고 다음 게시글을 조회한다.
    }
  }
  return { list, entries };
}

/**
 * 공고 상세, 문서 목록과 공지사항을 수집하고, 연결된 미수집 발주계획, 사전규격, 계약요청, 계약현황과 개찰결과를 저장한다.
 * 일반 부가 조회 오류는 허용하며, 점검을 확인하면 공고 행을 저장할 호출자에게 오류를 전달한다.
 * 독립적으로 완료된 관련 자료는 저장될 수 있다.
 * @param key 공고번호와 차수.
 * @param methodCode 상세 조회에 전달하는 낙찰방법 코드.
 * @returns 저장할 공고 원본과 이번 요청에서 처리한 개찰차수별 결과.
 * @throws 공고 상세 조회 또는 식별자 검증에 실패하거나 상세·부가 조회에서 점검을 확인한 경우.
 */
export async function collectNotice(
  key: NoticeKey,
  methodCode: string,
): Promise<{ notice: Notice; openingReport: OpeningCollectionReport }> {
  const collectedAt = new Date().toISOString();
  const payload = await postG2b(
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
  const detail = payload?.dmItemMap;
  if (
    detail?.bidPbancNo !== key.number ||
    String(detail.bidPbancOrd).padStart(3, "0") !== key.revision ||
    typeof detail.bidPbancNm !== "string" ||
    !detail.bidPbancNm.trim()
  ) {
    throw new Error("요청한 공고의 상세 응답을 받지 못했습니다.");
  }
  // 첨부 목록은 공고의 첨부 그룹만 조회하고, 제안요청은 상세 JS와 같이 협상계약에만 적용한다.
  const orderPlanNumber = getNoticeOrderPlanNumber(payload);
  const priorSpecNumber = getNoticePriorSpecNumber(payload);
  // 일반 부가 조회 오류는 공고 저장을 허용하지만, 점검이 하나라도 확인되면 공고 저장을 보류한다.
  const outcomes = await Promise.allSettled([
    detail.itemPbancUntyAtchFileNo?.trim()
      ? collectAttachments(detail.itemPbancUntyAtchFileNo, "notice")
      : undefined,
    detail.scsbdMthdCd === "낙030005" &&
    detail.rfpNo?.trim() &&
    /^\d{1,3}$/.test(String(detail.rfpOrd))
      ? collectProposal(detail.rfpNo, detail.rfpOrd, detail.prcmBsneSeCd)
      : undefined,
    collectNoticeContractLinks(key),
    collectNoticeOpeningResults(payload),
    collectNoticePosts(key),
    orderPlanNumber ? collectOrderPlan(orderPlanNumber) : undefined,
    priorSpecNumber ? collectPriorSpec(priorSpecNumber) : undefined,
  ]);
  const [attachments, proposal, contractLinks, openingResults, posts] = outcomes;
  if (openingResults.status === "rejected") throw openingResults.reason;
  const openingReport = openingResults.value;
  try {
    throwIfMaintenance(...outcomes, ...openingReport.failures.map(({ error }) => ({
      status: "rejected", reason: error,
    })));
  } catch (error) {
    throw new NoticeCollectionDeferred(openingReport, error);
  }
  if (openingReport.failures.length) console.error("개찰결과 수집 실패:", openingReport.failures);
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
