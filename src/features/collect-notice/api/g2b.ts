import {
  contractRequestKeys, contractRequestRevision, type ContractRequestKey,
} from '@/entities/contract-request/model/contract-request';
import type { Notice, NoticeKey } from '@/entities/notice';
import { getNoticeRepository } from '@/entities/notice/server';
import { groupOpeningResultQueries, openingResultQueries, type OpeningResultKey, type OpeningResultQuery } from '@/entities/opening-result/model/opening-result';
import { getNoticeOrderPlanNumber, orderPlanAttachmentGroup } from '@/entities/order-plan/model/order-plan';
import { getNoticePriorSpecNumber, type PriorSpec } from '@/entities/prior-spec/model/prior-spec';
import { createG2bSession } from '@/shared/api/g2b-session';
import { attachmentGroup, attachmentSources } from '@/shared/model/g2b-attachments';

const origin = 'https://www.g2b.go.kr';
const submissionPrefix = 'FIUA027_01_wframe_popupCnts_bidPbancWfrm_mainWframe_';
const detailMenu = '{"menuNo":"15620","menuCangVal":"FIUA027_01","bsneClsfCd":"%EC%97%85130020","scrnNo":"08542"}';
const workProgressMenu = '{"menuNo":"13677","menuCangVal":"FIUA009_01","bsneClsfCd":"%EC%97%85130020","scrnNo":"05665"}';
const openingResultMenu = '{"menuNo":"01523","menuCangVal":"PBOC007_01","bsneClsfCd":"%EC%97%85130028","scrnNo":"02128"}';
const unifiedSearchPath = '/fi/fiu/fiua/UntySrch';

class G2bAccessDenied extends Error {}

type G2bRequest = (url: URL, init: RequestInit) => Promise<Response>;

async function postG2b(path: string, submissionid: string, input: object, request: G2bRequest = fetch, menuInfo = detailMenu) {
  const response = await request(new URL(path, origin), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
      Origin: origin,
      'Menu-Info': menuInfo,
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
    // 자동 수집은 저장 상태에 따라 일부 조회를 건너뛸 수 있으므로 수동 재수집은 별도로 실행한다.
    await pending.promise.catch(() => undefined);
    return collectOnce(key, force, collect);
  }
  const promise = collect().finally(() => pendingCollections.delete(key));
  pendingCollections.set(key, { force, promise });
  return promise;
}

/**
 * 개찰차수의 유찰 상세를 수집해 복합 키로 저장한다.
 * @param key 공고번호, 공고차수, 개찰차수.
 * @param queries 해당 차수에서 확인된 분류별 조회 조건.
 * @param force 기본값은 false. true이면 이미 저장한 분류도 다시 조회한다.
 * @throws 유찰 상세가 없거나 조회에 실패했을 때. 기존 저장 자료는 유지된다.
 */
export async function collectOpeningResult(key: OpeningResultKey, queries: OpeningResultQuery[], force = false) {
  const repository = getNoticeRepository();
  return collectOnce(`opening-result:${key.number}/${key.revision}/${key.openingRevision}`, force, async () => {
    const saved = repository.findOpeningResult(key);
    const previous = force ? [] : saved?.results ?? [];
    const missing = queries.filter((query) => !previous.some((entry) => entry.query.classification === query.classification));
    if (!missing.length) return;

    const collectedAt = new Date().toISOString();
    const request = await createG2bSession();
    const results = await Promise.allSettled(missing.map(async (query) => {
      const payload = await postG2b('/pb/pbo/pboc/OnbsRslt/selectOnbsRsltFbid.do',
        submissionPrefix + 'onbsDtlInfo_wframe_popupCnts_selectOnbsRsltFbid', {
          dlSrchOnbsRsltBidInM: {
            bidPbancNo: key.number, bidPbancOrd: key.revision, bidPrgrsOrd: key.openingRevision,
            bidClsfNo: query.classification, prcmBsneSeCd: query.businessCode,
            bidPgstCd: '유찰', bzmnRegNo: '', reOpenPbancYN: 'Y',
          },
        }, request, openingResultMenu);
      const detail = payload?.result?.bidPrgrs;
      if (detail?.bidPbancNo !== key.number || String(detail.bidPbancOrd).padStart(3, '0') !== key.revision ||
          String(detail.bidPrgrsOrd).padStart(3, '0') !== key.openingRevision ||
          String(detail.bidClsfNo) !== query.classification) {
        throw new Error('요청한 개찰차수의 유찰 상세를 받지 못했습니다.');
      }
      return { query, detail };
    }));
    const entries = results.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
    repository.saveOpeningResult({ ...key, collectedAt, results: [...previous, ...entries] });
  });
}

async function collectNoticeOpeningResults(payload: Record<string, unknown>) {
  const groups = groupOpeningResultQueries(openingResultQueries(payload));
  await Promise.allSettled([...groups.values()].map(([first, ...rest]) => {
    const { number, revision, openingRevision } = first;
    return collectOpeningResult({ number, revision, openingRevision }, [first, ...rest]);
  }));
}

async function fetchContractRequestKeys({ number, revision }: NoticeKey) {
  const result = await postG2b(`${unifiedSearchPath}/srchWorkPrgs.do`, 'sbmWorkPrgs', {
    dlWorkParamM: { workSrchSeCd: 'BK', workBizNo: number, workBizOrd: revision },
  }, fetch, workProgressMenu);
  if (!Array.isArray(result.dlWorkPrgsL)) throw new Error('나라장터 업무 진행 응답 형식이 올바르지 않습니다.');
  return contractRequestKeys(result.dlWorkPrgsL, { number, revision });
}

const contractItemPageSize = 10;

function fetchContractRequestData(endpoint: string, { number, revision }: ContractRequestKey, page = 1) {
  return postG2b(`${unifiedSearchPath}/${endpoint}.do`, 'FIUA027_01_wframe_popupCnts_dmndWfrm_srchDtl', {
    dlSrchParamM: {
      untyInspIgiNo: '', untyPyprNo: '', ctrtDmndRcptNo: '', ctrtDmndRcptOrd: '',
      page: String(page), pageSize: String(contractItemPageSize), ctrtNo: '', ctrtChgOrd: '',
      bizNo: number, bizOrd: revision, prcmBsneSeCd: '',
    },
  });
}

async function collectContractRequestItems(key: ContractRequestKey) {
  const items: Record<string, unknown>[] = [];
  const seenPages = new Set<string>();
  for (let page = 1; ; page++) {
    const result = await fetchContractRequestData('srchDmndSttusItemSql', key, page);
    const rows = result.dlTotalSrchItemL;
    if (!Array.isArray(rows) || rows.some((row) =>
      row?.ctrtDmndRcptNo !== key.number || contractRequestRevision(row.ctrtDmndRcptOrd) !== key.revision)) {
      throw new Error('요청한 계약요청의 품목 응답을 받지 못했습니다.');
    }
    // API가 다음 페이지에도 같은 품목을 반환하면 중복 저장과 무한 조회를 막는다.
    const signature = JSON.stringify(rows.map(({ rowNum, ...item }) => item));
    if (seenPages.has(signature)) throw new Error('나라장터가 같은 계약요청 품목 페이지를 반복 반환했습니다.');
    seenPages.add(signature);
    items.push(...rows);
    if (rows.length < contractItemPageSize) return items;
  }
}

/**
 * 계약요청의 상세와 품목을 수집해 함께 저장한다.
 * @param key 계약요청접수번호와 차수.
 * @param force 기본값은 false. true이면 기존 자료도 다시 조회한다.
 * @throws 상세 또는 품목 조회에 실패했을 때. 기존 저장 자료는 유지된다.
 */
export async function collectContractRequest(key: ContractRequestKey, force = false) {
  const repository = getNoticeRepository();
  return collectOnce(`contract-request:${key.number}/${key.revision}`, force, async () => {
    if (!force && repository.findContractRequest(key)) return;
    const collectedAt = new Date().toISOString();
    const [summary, items] = await Promise.allSettled([
      fetchContractRequestData('srchDmndSttusSql', key),
      collectContractRequestItems(key),
    ]);
    if (summary.status === 'rejected') throw summary.reason;
    if (items.status === 'rejected') throw items.reason;
    const result = summary.value;
    const detail = Array.isArray(result.dlTotalSrchL) && result.dlTotalSrchL.find((row: Record<string, unknown>) =>
      row?.bizNo === key.number && contractRequestRevision(row.bizOrd) === key.revision);
    if (!detail) throw new Error('요청한 계약요청의 상세 응답을 받지 못했습니다.');
    repository.saveContractRequest({ ...key, collectedAt, detail, items: items.value });
  });
}

async function collectNoticeContractRequests(key: NoticeKey) {
  const requests = await fetchContractRequestKeys(key);
  // 상세 조회가 실패해도 공고에는 확인된 연결을 남겨 해당 페이지에서 다시 수집할 수 있게 한다.
  await Promise.allSettled(requests.map((request) => collectContractRequest(request)));
  return requests;
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
 * 공고 상세와 문서 목록을 수집하고, 연결된 미수집 발주계획, 사전규격, 계약요청과 개찰결과를 저장한다.
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
  const [attachments, proposal, contractRequests] = await Promise.allSettled([
    detail.itemPbancUntyAtchFileNo?.trim() ? collectAttachments(detail.itemPbancUntyAtchFileNo, 'notice') : undefined,
    detail.scsbdMthdCd === '낙030005' && detail.rfpNo?.trim() && /^\d{1,3}$/.test(String(detail.rfpOrd))
      ? collectProposal(detail.rfpNo, detail.rfpOrd, detail.prcmBsneSeCd)
      : undefined,
    collectNoticeContractRequests(key),
    collectNoticeOpeningResults(payload),
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

  return { ...key, title: detail.bidPbancNm, collectedAt, payload, documents,
    contractRequests: contractRequests.status === 'fulfilled' ? contractRequests.value : undefined };
}
