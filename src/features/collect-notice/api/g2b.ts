import type { Notice, NoticeKey } from '@/entities/notice';
import { getNoticeRepository } from '@/entities/notice/server';
import { getNoticeOrderPlanNumber, orderPlanAttachmentGroup } from '@/entities/order-plan/model/order-plan';
import { getNoticePriorSpecNumber, type PriorSpec } from '@/entities/prior-spec/model/prior-spec';
import { createG2bSession } from '@/shared/api/g2b-session';
import { attachmentGroup, attachmentSources } from '@/shared/model/g2b-attachments';

const origin = 'https://www.g2b.go.kr';
const submissionPrefix = 'FIUA027_01_wframe_popupCnts_bidPbancWfrm_mainWframe_';

class G2bAccessDenied extends Error {}

type G2bRequest = (url: URL, init: RequestInit) => Promise<Response>;

async function postG2b(path: string, submissionid: string, input: object, request: G2bRequest = fetch) {
  const response = await request(new URL(path, origin), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
      Origin: origin,
      'Menu-Info': '{"menuNo":"15620","menuCangVal":"FIUA027_01","bsneClsfCd":"%EC%97%85130020","scrnNo":"08542"}',
      submissionid,
    },
    body: JSON.stringify(input),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 403) throw new G2bAccessDenied(`나라장터 API 접근이 거부됐습니다: ${path}`);
  if (!response.ok) throw new Error(`나라장터 API 요청에 실패했습니다: ${path}`);
  const result = await response.json();
  if (String(result?.ErrorCode) !== '0') throw new Error(`나라장터 API가 오류를 반환했습니다: ${path}`);
  return result;
}

async function collectDocumentList(path: string, submission: string, input: object, request?: G2bRequest) {
  const result = await postG2b(path, submission, input, request);
  if (!Array.isArray(result.dlUntyAtchFileL)) {
    throw new Error(`나라장터 문서 목록 응답 형식이 올바르지 않습니다: ${path}`);
  }
  return result;
}

function collectAttachments(untyAtchFileNo: string, scope: keyof typeof attachmentSources, request?: G2bRequest) {
  return collectDocumentList('/fs/fsc/fscb/UntyAtchFile/selectUntyAtchFileList.do', 'sbmInsertAtflGrp', {
    dlUntyAtchFileM: {
      ...attachmentSources[scope], untyAtchFileNo, atchFileSqnos: '', bsneClsfCd: '업130020', webPathUse: 'N',
      isScanEnabled: false, imgUrl: '', atchFileKndCds: '', ignoreAtchFileKndCds: '',
      kbrdrIds: '', kuploadId: '', viewMode: 'view', ignoreScrnIndtYn: '',
    },
  }, request);
}

async function collectProposal(rfpNo: string, rfpOrd: string | number, prcmBsneSeCd: string) {
  const request = await createG2bSession();
  return collectDocumentList('/pr/prp/prpc/Rfp/selectRfpDtl.do', submissionPrefix + 'sbmRfp', {
    dlRfpM: { rfpNo, rfpOrd, prcmBsneSeCd, ctrtImplPicYn: 'Y' },
  }, request);
}

const pendingCollections = new Map<string, { force: boolean; promise: Promise<void> }>();

async function collectOnce(key: string, force: boolean, collect: () => Promise<void>) {
  const pending = pendingCollections.get(key);
  if (pending) {
    if (!force || pending.force) return pending.promise;
    // 수동 재수집은 첨부 보완만 진행 중이어도 상세 조회까지 실행해야 한다.
    await pending.promise.catch(() => undefined);
    return collectOnce(key, force, collect);
  }
  const promise = collect().finally(() => pendingCollections.delete(key));
  pendingCollections.set(key, { force, promise });
  return promise;
}

/**
 * 발주계획 상세와 첨부 목록을 수집해 저장한다.
 * @param number 발주계획번호.
 * @param force 기본값은 false. true이면 상세와 첨부를 모두 다시 조회하고 성공 시 교체한다.
 * @throws 나라장터 상세 또는 첨부 목록 조회가 실패했을 때.
 */
export async function collectOrderPlan(number: string, force = false) {
  const repository = getNoticeRepository();

  return collectOnce(`order-plan:${number}`, force, async () => {
    let plan = force ? null : repository.findOrderPlan(number);
    if (plan && (plan.attachments || !orderPlanAttachmentGroup(plan))) return;
    const request = await createG2bSession();
    if (!plan) {
      const collectedAt = new Date().toISOString();
      const payload = await postG2b('/pr/prp/prpa/OderPlan/selectOderPlan.do',
        'FIUA027_01_wframe_popupCnts_orderPlanWfrm_sbmSrch',
        { dlParamM: { oderPlanNo: number, resultCnt: '' } }, request);
      if (payload?.dlOderPlanM?.oderPlanNo !== number) {
        throw new Error('요청한 발주계획의 상세 응답을 받지 못했습니다.');
      }
      plan = { number, collectedAt, payload };
      // 첨부 목록 요청에 실패해도 본문을 보존하고 다음 수집에서 첨부만 재시도한다.
      if (!force) repository.saveOrderPlan(plan);
    }
    const group = orderPlanAttachmentGroup(plan);
    const attachments = group ? await collectAttachments(group, 'order-plan', request) : undefined;
    if (force) repository.replaceOrderPlan({ ...plan, attachments });
    else if (attachments) repository.saveOrderPlanAttachments(number, plan.collectedAt, attachments);
  });
}

/**
 * 사전규격 상세와 공개 첨부 목록을 번호별로 수집한다.
 * @param number 사전규격등록번호.
 * @param force 기본값은 false. true이면 상세와 첨부를 다시 조회하고 성공 시 교체한다.
 * @throws 나라장터 상세 또는 첨부 목록 조회가 실패했을 때.
 */
export async function collectPriorSpec(number: string, force = false) {
  const repository = getNoticeRepository();
  return collectOnce(`prior-spec:${number}`, force, async () => {
    let spec: PriorSpec | null = force ? null : repository.findPriorSpec(number);
    if (spec && (spec.attachments || !attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo))) return;
    const request = await createG2bSession();
    if (!spec) {
      const collectedAt = new Date().toISOString();
      const payload = await postG2b('/pn/pnz/pnza/BfSpec/selectBfSpec.do',
        'FIUA027_01_wframe_popupCnts_bfSpecWfrm_sbmSrch',
        { dlParamM: { bfSpecRegNo: number, prcmBsneSeCd: '', opnnSqno: '', jobType: '' } }, request);
      if (payload?.dlBfSpecM?.bfSpecRegNo !== number) {
        throw new Error('요청한 사전규격의 상세 응답을 받지 못했습니다.');
      }
      spec = { number, collectedAt, payload };
      if (!force) repository.savePriorSpec(spec);
    }
    const group = attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo);
    const attachments = group ? await collectAttachments(group, 'prior-spec', request) : undefined;
    if (force || attachments) repository.savePriorSpec({ ...spec, attachments });
  });
}

/**
 * 공고 상세와 문서 목록을 수집하고, 연결된 미수집 발주계획과 사전규격을 별도로 저장한다.
 * 관련 자료 조회가 실패하면 다음 공고 수집 시 재시도한다.
 * @param key 공고번호와 차수.
 * @param methodCode 상세 조회에 전달하는 낙찰방법 코드.
 * @returns 공고 상세 및 해당하는 문서 목록의 원본 응답.
 * @throws 공고 상세 요청이 실패하거나 해당 공고의 응답을 받지 못했을 때.
 */
export async function collectNotice(key: NoticeKey, methodCode: string): Promise<Notice> {
  const collectedAt = new Date().toISOString();
  const payload = await postG2b('/pn/pnp/pnpe/ItemBidPbac/selectItemAnncMngV.do', submissionPrefix + 'selectItemAnncMngV', {
    dmItemMap: {
      bidPbancNo: key.number, bidPbancOrd: key.revision, scsbdMthdCd: methodCode, currentPage: 1,
    },
  });
  const detail = payload?.dmItemMap;
  if (detail?.bidPbancNo !== key.number ||
      String(detail.bidPbancOrd).padStart(3, '0') !== key.revision ||
      typeof detail.bidPbancNm !== 'string' || !detail.bidPbancNm.trim()) {
    throw new Error('요청한 공고의 상세 응답을 받지 못했습니다.');
  }
  // 첨부 목록은 공고의 첨부 그룹만 조회하고, 제안요청은 상세 JS와 같이 협상계약에만 적용한다.
  const orderPlanNumber = getNoticeOrderPlanNumber(payload);
  const priorSpecNumber = getNoticePriorSpecNumber(payload);
  const [attachments, proposal] = await Promise.allSettled([
    detail.itemPbancUntyAtchFileNo?.trim() ? collectAttachments(detail.itemPbancUntyAtchFileNo, 'notice') : undefined,
    detail.scsbdMthdCd === '낙030005' && detail.rfpNo?.trim() && /^\d{1,3}$/.test(String(detail.rfpOrd))
      ? collectProposal(detail.rfpNo, detail.rfpOrd, detail.prcmBsneSeCd)
      : undefined,
    orderPlanNumber ? collectOrderPlan(orderPlanNumber) : undefined,
    priorSpecNumber ? collectPriorSpec(priorSpecNumber) : undefined,
  ]);
  // 문서 조회 오류가 공고 상세와 다른 문서의 저장을 막지 않도록 실패 종류를 따로 기록한다.
  const documents: NonNullable<Notice['documents']> = {
    attachments: attachments.status === 'fulfilled' ? attachments.value : undefined,
    proposal: proposal.status === 'fulfilled' ? proposal.value : undefined,
    unavailable: [],
  };
  if (attachments.status === 'rejected') documents.unavailable?.push('attachments');
  if (proposal.status === 'rejected') {
    documents.unavailable?.push('proposal');
    if (proposal.reason instanceof G2bAccessDenied) documents.proposalAccessDenied = true;
  }

  return { ...key, title: detail.bidPbancNm, collectedAt, payload, documents };
}
