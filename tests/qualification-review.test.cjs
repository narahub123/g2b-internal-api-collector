require('../scripts/register-project-typescript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findMaintenance } = require('../src/shared/api/g2b/g2b-maintenance');

const query = { number: 'R26BK00000001', revision: '001', openingRevision: '002', classification: '3', businessCode: '01', status: '개찰완료' };
const identity = { bidPbancNo: query.number, bidPbancOrd: '1', bidPrgrsOrd: '2', bidClsfNo: '3' };
const bid = { ErrorCode: 0, areaNm: '서울 &amp; 경기', bidPbanc: { ...identity, bidPbancNm: '테스트', hidden: '내부' } };
const rows = Array.from({ length: 7 }, (_, index) => ({
  ...identity, grpNm: `테스트 업체 ${index + 1}`, bzmnRegNo: '0123456789', rlsYn: 'N',
  qlemRslt: index < 6 ? '적격심사 대상통보' : '적격심사신청서 작성중',
  objcCn: index === 1 ? '두 번째 업체' : null, srngSumScr: '99',
}));
const judgments = { ErrorCode: 0, openYn: 'N', dlSelectYnM: { selectYn: 'Y' }, qlemRsltJdgmntList: rows };

function setup(...responses) {
  const requests = [];
  return {
    requests,
    request: async (url, init) => {
      requests.push({ path: url.pathname, headers: new Headers(init.headers), body: JSON.parse(init.body) });
      const response = responses.shift();
      return typeof response === 'string' ? new Response(response) : Response.json(response);
    },
  };
}

test('물품·용역·공사는 같은 적격심사 조건을 적용하며 설계공모와 재입찰은 제외한다', () => {
  const { getOpeningResultDisplay, qualificationReviewVisible } = require('../src/entities/opening-result/model/opening-result-display');
  for (const [businessCode, endpoint, isPssrp, expected] of [
    ['01', 'selectOnbsRsltSbidGods', false, true],
    ['03', 'selectOnbsRsltSbidGods', false, true],
    ['05', 'selectOnbsRsltSbidSrvc', false, true],
    ['07', 'selectOnbsRsltSbidCstn', false, true],
    ['05', 'selectOnbsRsltSbidSrvc', true, false],
  ]) {
    const detail = { bidInfo: { scsbdMthdCd: '낙030033' }, etcData: { isPssrp }, successBidInfo: [] };
    assert.equal(qualificationReviewVisible(endpoint, detail), expected);
    const display = getOpeningResultDisplay({ ...query, businessCode }, detail, () => undefined);
    assert.equal(display.sections.some((section) =>
      section.kind === 'fields' && section.fields.some((field) => field.key === 'qualificationReview')), expected);
    assert.equal(qualificationReviewVisible('selectOnbsRsltRbid', detail), false);
  }
});

test('HAR 순서대로 공고와 판정을 요청하고 선언된 데이터맵만 전송한다', async () => {
  const { fetchQualificationReview } = require('../src/features/collect-g2b/api/qualification-review');
  const { request, requests } = setup(bid, judgments);
  assert.deepEqual(await fetchQualificationReview(query, request), { bidResponse: bid, judgmentResponse: judgments });
  assert.deepEqual(requests.map(({ path }) => path.split('/').at(-1)), ['selectBidInfo.do', 'selectQlemRsltJdgmntList.do']);
  assert.deepEqual(requests[0].body, { dlParamM: { ...identity, bidPbancOrd: '001', bidPrgrsOrd: '002', openYn: '', rsltReptTyCd: '', prcmEtpsYn: '', bzmnRegNo: '' } });
  assert.deepEqual(requests[1].body.dlParamM, requests[0].body.dlParamM);
  assert.equal(requests[1].body.dlBidPbancM.bidPbancNm, '테스트');
  assert.equal(requests[1].body.dlBidPbancM.sedrUsrNm, '');
  assert.equal('hidden' in requests[1].body.dlBidPbancM, false);
  assert.match(requests[0].headers.get('Menu-Info'), /01408/);
  assert.match(requests[1].headers.get('submissionid'), /QlemRsltJdgmntL_wframe_popupCnts_selectElgbSrngRsltjgmntList$/);
});

test('조회 불가와 0건은 null이며 잘못된 분류·차수·업무 응답·점검은 실패한다', async () => {
  const { fetchQualificationReview } = require('../src/features/collect-g2b/api/qualification-review');
  for (const response of [
    { ErrorCode: 0, dlSelectYnM: { selectYn: 'N' } },
    { ...judgments, qlemRsltJdgmntList: [] },
  ]) assert.equal(await fetchQualificationReview(query, setup(bid, response).request), null);

  const mismatch = setup({ ...bid, bidPbanc: { ...bid.bidPbanc, bidClsfNo: '4' } });
  await assert.rejects(fetchQualificationReview(query, mismatch.request), /식별자/);
  assert.equal(mismatch.requests.length, 1);
  await assert.rejects(fetchQualificationReview(query, setup(bid, {
    ...judgments, qlemRsltJdgmntList: [{ ...rows[0], bidPrgrsOrd: '003' }],
  }).request), /식별자/);
  await assert.rejects(fetchQualificationReview(query, setup(bid, { ErrorCode: 99 }).request));
  await assert.rejects(fetchQualificationReview(query, setup(bid,
    '<html><title>시스템 점검 안내</title><p>현재 웹 서비스가 중단되고 있음을 알려드립니다.</p></html>',
  ).request), (error) => Boolean(findMaintenance(error)));
});

test('HAR와 같은 7건의 상태를 순서대로 출력하되 내부 점수와 사유는 직렬화하지 않는다', () => {
  const { getQualificationReviewDisplay } = require('../src/entities/opening-result/model/qualification-review-display');
  const view = getQualificationReviewDisplay({ bidResponse: bid, judgmentResponse: judgments });
  assert.equal(view.rows.length, 7);
  assert.equal(view.rows[0].cells.bzmnRegNo, '012-34-56789');
  assert.equal(view.fields.find((field) => field.key === 'areaNm').value, '서울 & 경기');
  assert.equal(view.rows[1].fields.find((field) => field.key === 'objcCn').value, '두 번째 업체');
  assert.deepEqual(view.rows.map(({ cells }) => cells.qlemRslt), [...Array(6).fill('적격심사 대상통보'), '적격심사신청서 작성중']);
  assert.ok(view.rows.every(({ cells }) => !cells.srch && !cells.srch2 && !('srngSumScr' in cells)));
});
