import type { Notice, NoticeKey } from '@/entities/notice';
import { createG2bSession } from '@/shared/api/g2b-session';

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

function collectAttachments(untyAtchFileNo: string) {
  return collectDocumentList('/fs/fsc/fscb/UntyAtchFile/selectUntyAtchFileList.do', 'sbmInsertAtflGrp', {
    dlUntyAtchFileM: {
      untyAtchFileNo, atchFileSqnos: '', bsnePath: 'PNPE', bsneClsfCd: '업130020',
      tblNm: 'PBANC_BID_PBANC', colNm: 'ITEM_PBANC_UNTY_ATCH_FILE_NO', webPathUse: 'N',
      isScanEnabled: false, imgUrl: '', atchFileKndCds: '', ignoreAtchFileKndCds: '',
      kbrdrIds: '', kuploadId: '', viewMode: 'view', ignoreScrnIndtYn: '',
    },
  });
}

async function collectProposal(rfpNo: string, rfpOrd: string | number, prcmBsneSeCd: string) {
  const request = await createG2bSession();
  return collectDocumentList('/pr/prp/prpc/Rfp/selectRfpDtl.do', submissionPrefix + 'sbmRfp', {
    dlRfpM: { rfpNo, rfpOrd, prcmBsneSeCd, ctrtImplPicYn: 'Y' },
  }, request);
}

/**
 * 공고 상세와 연결된 문서 목록을 수집한다.
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
  const [attachments, proposal] = await Promise.allSettled([
    detail.itemPbancUntyAtchFileNo?.trim() ? collectAttachments(detail.itemPbancUntyAtchFileNo) : undefined,
    detail.scsbdMthdCd === '낙030005' && detail.rfpNo?.trim() && /^\d{1,3}$/.test(String(detail.rfpOrd))
      ? collectProposal(detail.rfpNo, detail.rfpOrd, detail.prcmBsneSeCd)
      : undefined,
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
