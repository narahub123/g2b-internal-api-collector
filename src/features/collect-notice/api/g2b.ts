import type { Notice, NoticeKey } from '@/entities/notice';

const endpoint = 'https://www.g2b.go.kr/pn/pnp/pnpe/ItemBidPbac/selectItemAnncMngV.do';

export async function collectNotice(key: NoticeKey, methodCode: string): Promise<Notice> {
  const collectedAt = new Date().toISOString();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
      Origin: 'https://www.g2b.go.kr',
      'Menu-Info': '{"menuNo":"15620","menuCangVal":"FIUA027_01","bsneClsfCd":"%EC%97%85130020","scrnNo":"08542"}',
      submissionid: 'FIUA027_01_wframe_popupCnts_bidPbancWfrm_mainWframe_selectItemAnncMngV',
    },
    body: JSON.stringify({
      dmItemMap: {
        bidPbancNo: key.number,
        bidPbancOrd: key.revision,
        scsbdMthdCd: methodCode,
        currentPage: 1,
      },
    }),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('나라장터 상세 API 요청에 실패했습니다.');

  const payload = await response.json();
  const detail = payload?.dmItemMap;
  if (String(payload?.ErrorCode) !== '0' || detail?.bidPbancNo !== key.number ||
      String(detail.bidPbancOrd).padStart(3, '0') !== key.revision ||
      typeof detail.bidPbancNm !== 'string' || !detail.bidPbancNm.trim()) {
    throw new Error('요청한 공고의 상세 응답을 받지 못했습니다.');
  }
  return { ...key, title: detail.bidPbancNm, collectedAt, payload };
}
