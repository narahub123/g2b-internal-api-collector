require('../scripts/register-project-typescript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getBaseAmountDisplay, baseAmountAdjustmentFile, noticeBaseAmountRows } =
  require('../src/entities/notice/model/base-amount');
const { fetchBaseAmountDetail } = require('../src/features/collect-g2b/api/base-amount');

const key = { number: 'R26BK01789731', revision: '000' };
const identity = { bidPbancNo: key.number, bidPbancOrd: key.revision };
const goods = {
  ErrorCode: 0,
  result: {
    bidInfo: { ...identity, prcmBsneSeCd: '01', bidPbancNm: '물품 공고', atmr: '비공개 안내' },
    baseEstiPrice: {},
    isFixDateOver: true,
    isPureConstExpsTrget: "Y",
    isNegotiation: 'false',
    listBaseEstiPrice: [
      { ...identity, bidClsfNo: '1', bsamt: 28600000, rsvePrceRangSeCd: '예070003', prceCrtRangRt: 2 },
      { ...identity, bidClsfNo: '2', bsamt: 1700000 },
    ],
  },
};

test('물품 상세는 HAR과 같은 금액·복수예가를 표시하고 분류 순서를 유지한다', () => {
  const before = JSON.stringify(goods);
  const view = getBaseAmountDisplay(goods);
  const tree = JSON.stringify(view.nodes);
  assert.match(tree, /공고일반/);
  assert.match(tree, /기초금액기준 ± 2/);
  assert.doesNotMatch(tree, /공사 기초금액|비공개 안내/);
  assert.deepEqual(view.rows.map(({ bidClsfNo, bsamt }) => [bidClsfNo, bsamt]), [
    ['1', '28,600,000'], ['2', '1,700,000'],
  ]);
  assert.equal(JSON.stringify(goods), before);
});

test('용역 분기는 원본 날짜 플래그에 따라 예비가격 행을 표시한다', () => {
  for (const [code, flag] of [['03', 'isFixDateOver'], ['05', 'isDualStdStartDtOver']]) {
    for (const allowed of [true, false]) {
      const raw = structuredClone(goods);
      raw.result.bidInfo.prcmBsneSeCd = code;
      raw.result[flag] = allowed;
      raw.result.baseEstiPrice = { bsamt: 2600000, prceCrtRangRt: 3, rsvePrceRangSeCd: '예070001' };
      const tree = JSON.stringify(getBaseAmountDisplay(raw).nodes);
      assert.ok(tree.includes('공고일반-기초금액'));
      assert.ok(tree.includes('참고사항1'));
      assert.equal(tree.includes('기초금액기준 + 3'), allowed);
    }
  }
});

test('공사 상세는 순공사원가와 조정사유서의 표시 여부를 원본 조건으로 판정한다', () => {
  const raw = structuredClone(goods);
  const group = '12345678-1234-1234-1234-123456789abc';
  raw.result.bidInfo = { ...identity, prcmBsneSeCd: '07', pbancInstCd: '123456', lcrtTyCd: '계040001' };
  raw.result.baseEstiPrice = {
    bsamt: 100, bsamtPcsp: 80, basePdamtYn: "true", chkDt20120406000000: 'true', percentageYn: 'N',
    isNewG2bOpenDateOver: 'Y', oldPbancSpecUntyAtchFileNo: group, adjsSmrsAtchFileSqno: 2,
  };
  const view = getBaseAmountDisplay(raw);
  assert.match(JSON.stringify(view.nodes), /순공사원가/);
  assert.doesNotMatch(JSON.stringify(view.nodes), /기초금액기준/);
  assert.deepEqual(baseAmountAdjustmentFile(raw, view), { group, seq: '2' });
  raw.result.bidInfo.pbancInstCd = '999456';
  assert.equal(baseAmountAdjustmentFile(raw, getBaseAmountDisplay(raw)), undefined);
});

test('수집 대상은 기존 기초금액공개 표의 조건을 적용한다', () => {
  const rows = [{ baseAmt: 1 }];
  assert.deepEqual(noticeBaseAmountRows({ dmItemMap: {}, dmItemBaseAmtList: rows }), rows);
  assert.deepEqual(noticeBaseAmountRows({ dmItemMap: { pnprDcsnMthoCd: '예050001' }, dmItemBaseAmtList: rows }), []);
});

test('HAR의 요청 형식을 사용하고 식별자가 다른 응답을 거부한다', async () => {
  const request = async (url, init) => {
    assert.equal(url.pathname, '/pp/ppp/pppb/bsisAmtDetlInqy/selectBaseAmtDtlPopup.do');
    assert.match(init.headers.submissionid, /selectBsisAmtInqyList_wframe_popupCnts_sbmSrch$/);
    assert.equal(JSON.parse(init.headers['Menu-Info']).menuCangVal, 'PPPB009_01');
    assert.deepEqual(JSON.parse(init.body), { dlBsisAmtM: { ...identity, sign: '', sign2: '', sign3: '' } });
    return Response.json(goods);
  };
  assert.deepEqual(await fetchBaseAmountDetail(key, request), goods);
  await assert.rejects(fetchBaseAmountDetail(key, async () => Response.json({
    ...goods, result: { ...goods.result, bidInfo: { ...identity, bidPbancOrd: '002' } },
  })), /공고/);
});

test('조달청 최신 공사와 이전 공사의 법정경비 양식 파일명을 구분한다', () => {
  const raw = structuredClone(goods);
  raw.result.bidInfo = { ...identity, prcmBsneSeCd: '07', pbancInstCd: '123456', lcrtTyCd: '계040001' };
  raw.result.baseEstiPrice = {
    bsamt: 100, chkDt20120406000000: 'true', retirAndSafeYn: 'Y2',
    isConstBidOfNewQlfdJudgeYn: 'Y', methodCdIsJdgmnClCdYn: 'Y',
    sftyMgcsAprtTrgtYn: 'Y', qltyMgcsAprtTrgtYn: 'Y',
  };
  raw.result.labrrPrtcAndCnstrcSafeAmtInfo = {
    pbancPstgDt: '20260313000000', aamtinfosumamt: 3000, aamtinfosumamt2: 4500,
  };
  const current = getBaseAmountDisplay(raw);
  assert.equal(current.standardFilename, 'Cost_Standard_New_20260313.hwp');
  assert.ok(current.visibleIds.has('btnSttyEpnsCmpuBais'));
  assert.match(JSON.stringify(current.nodes), /4,500/);
  raw.result.labrrPrtcAndCnstrcSafeAmtInfo.pbancPstgDt = '20260312235959';
  assert.equal(getBaseAmountDisplay(raw).standardFilename, 'Cost_Standard_New_20200910.hwp');
  raw.result.baseEstiPrice.chkDt20120406000000 = 'false';
  assert.equal(getBaseAmountDisplay(raw).visibleIds.has('btnSttyEpnsCmpuBais'), false);
});

test('실패한 기초금액 상세와 공지만 복구하며 성공한 빈 공지 및 파일 제거를 보존한다', () => {
  const { mergeNoticeBaseAmount } = require('../src/entities/notice/model/base-amount');
  const posts = {
    list: { dlPstL: [{ bbsNo: 'R23AB00000204', pstNo: '1' }] },
    entries: [{ bbsNo: 'R23AB00000204', pstNo: '1', body: {} }],
  };
  const adjustment = { group: '12345678-1234-1234-1234-123456789abc', seq: '1', response: {} };
  const previous = { detail: goods, posts, adjustment };
  const retained = mergeNoticeBaseAmount({ unavailable: ['detail', 'posts'] }, previous);
  assert.equal(retained.detail, goods);
  assert.equal(retained.posts, posts);
  assert.deepEqual(retained.retained, ['detail', 'posts']);
  const empty = { list: { dlPstL: [] }, entries: [] };
  const fresh = mergeNoticeBaseAmount({ detail: goods, posts: empty, unavailable: ['adjustment'] }, previous);
  assert.deepEqual(fresh.posts, empty);
  assert.equal(fresh.adjustment, undefined);
  assert.deepEqual(fresh.retained, []);
});

test('조정사유서는 저장된 공개·허용 파일의 그룹과 순번을 요청에서 다시 확인한다', async (t) => {
  const { resolvePublicAttachmentDownload } =
    require('../src/features/download-g2b-attachment/server/public-attachment-download');
  const group = '12345678-1234-1234-1234-123456789abc';
  const file = {
    untyAtchFileNo: group, atchFileSqno: '2', scrnIndtYn: 'Y', dwnldPrmsYn: 'Y',
    orgnlAtchFileNm: 'adjustment.hwp', atchFilePathNm: '/data/Attachfiles/test/adjustment.hwp',
  };
  let current = file;
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body).dlUntyAtchFileM;
    assert.equal(request.untyAtchFileNo, group);
    assert.equal(request.bsnePath, 'pexm');
    assert.equal(request.colNm, 'PBANC_SPEC_UNTY_ATCH_FILE_NO');
    return Response.json({ ErrorCode: 0, dlUntyAtchFileL: [current] });
  });
  const saved = { dlUntyAtchFileL: [file] };
  const resolve = (seq) => resolvePublicAttachmentDownload(group, saved, seq, 'base-amount-adjustment');
  assert.equal(await resolve('1'), null);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal((await resolve('2')).origin, 'https://www.g2b.go.kr');
  current = { ...file, dwnldPrmsYn: 'N' };
  assert.equal(await resolve('2'), null);
});
