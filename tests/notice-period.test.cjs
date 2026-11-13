require('../scripts/register-project-typescript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { listNoticePeriodTargets } = require('../src/features/collect-g2b/api/notice-period');
const { findMaintenance } = require('../src/shared/api/g2b/g2b-maintenance');

const start = '2026-11-11T23:59';
const end = '2026-11-12T00:00';

function row(number, time, overrides = {}) {
  return {
    bidPbancUntyNo: number, bidPbancUntyOrd: '000', bidPbancNm: '입찰공고',
    scsbdMthdCd: '낙030029', pbancPstgDt: time + '&lt;br/&gt;&#40;-&#41;',
    nextRowYn: 'N', ...overrides,
  };
}

function fixture(...responses) {
  const pages = [];
  const waits = [];
  let sessions = 0;
  const dependencies = {
    async createSession() {
      sessions++;
      return async (_url, init) => {
        pages.push(JSON.parse(init.body).dlBidPbancLstM);
        assert.ok(responses.length, '예상하지 않은 추가 요청');
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response instanceof Response ? response : Response.json({ ErrorCode: 0, result: response });
      };
    },
    async wait(ms) { waits.push(ms); },
  };
  return { dependencies, pages, waits, get sessions() { return sessions; } };
}

test('분 경계와 자정을 포함하고 업무구분 전체를 페이지 끝까지 조회한다', async () => {
  const first = row('R26BK1', '2026/11/11 23:59', { prcmBsneSeCdNm: '공사', bidPbancUntyOrd: '00' });
  const second = row('R26BK2', '2026/11/12 00:00', { prcmBsneSeCdNm: '기술용역', bidPbancUntyOrd: '001' });
  const f = fixture([first, row('R26BK3', '2026/11/11 23:58')], [first, { ...first, bidPbancUntyOrd: '001' }], [],
    [second, row('R26BK4', '2026/11/12 00:01')], []);
  const result = await listNoticePeriodTargets(start, end, f.dependencies);
  assert.deepEqual(result.map(({ number, revision }) => [number, revision]), [
    ['R26BK1', '000'], ['R26BK1', '001'], ['R26BK2', '001'],
  ]);
  assert.equal(result[0].title, '입찰공고');
  assert.equal(result[0].methodCode, '낙030029');
  assert.deepEqual(f.pages.map(({ fromBidDt, toBidDt, startIndex, endIndex }) =>
    [fromBidDt, toBidDt, startIndex, endIndex]), [
    ['20261111', '20261111', 1, 150], ['20261111', '20261111', 3, 152],
    ['20261111', '20261111', 5, 154], ['20261112', '20261112', 1, 150],
    ['20261112', '20261112', 3, 152],
  ]);
  assert.ok(f.pages.every((page) => page.pbancKndCd === '' && page.bsneAllYn === 'Y'));
});

test('잘못된 기간은 요청 전에 거부하고 정상 빈 목록은 성공으로 반환한다', async () => {
  const f = fixture([]);
  await assert.rejects(listNoticePeriodTargets(end, start, f.dependencies), RangeError);
  await assert.rejects(listNoticePeriodTargets('2026-02-30T00:00', end, f.dependencies), RangeError);
  assert.equal(f.sessions, 0);
  assert.deepEqual(await listNoticePeriodTargets(start, start, f.dependencies), []);
});

test('통신 오류와 429를 같은 페이지에서 재시도한다', async () => {
  const f = fixture(new TypeError('fetch failed'), new Response(null, { status: 429, headers: { 'Retry-After': '7' } }), []);
  assert.deepEqual(await listNoticePeriodTargets(start, start, f.dependencies), []);
  assert.deepEqual(f.waits, [2000, 7000]);
  assert.deepEqual(f.pages.map((page) => page.startIndex), [1, 1, 1]);
});

test('5xx는 최초 요청을 포함해 세 번 시도한다', async () => {
  const f = fixture(...Array.from({ length: 3 }, () => new Response(null, { status: 503 })));
  await assert.rejects(listNoticePeriodTargets(start, start, f.dependencies));
  assert.deepEqual(f.waits, [2000, 5000]);
  assert.equal(f.pages.length, 3);
});

test('세션 오류 403에서만 세션을 한 번 갱신한다', async () => {
  const denied = (code) => Response.json({ ErrorCode: code }, { status: 403 });
  const f = fixture(denied(-801), []);
  assert.deepEqual(await listNoticePeriodTargets(start, start, f.dependencies), []);
  assert.equal(f.sessions, 2);
  const rejected = fixture(denied(-999));
  await assert.rejects(listNoticePeriodTargets(start, start, rejected.dependencies));
  assert.equal(rejected.sessions, 1);
  const repeated = fixture(denied(-801), denied(-801));
  await assert.rejects(listNoticePeriodTargets(start, start, repeated.dependencies));
  assert.equal(repeated.sessions, 2);
});

test('점검은 HTTP 상태와 관계없이 별도 신호로 전파한다', async () => {
  const f = fixture(new Response('<title>시스템 점검 안내</title><p>현재 웹 서비스가 중단되고 있음을 알려드립니다</p>'));
  await assert.rejects(listNoticePeriodTargets(start, start, f.dependencies), (error) => Boolean(findMaintenance(error)));
  assert.deepEqual(f.waits, []);
});

test('반복 페이지와 손상된 응답은 앞서 조회한 대상을 반환하지 않는다', async () => {
  const valid = row('R26BK1', '2026/11/11 23:59');
  for (const bad of [[valid], [null], [{ ...valid, bidPbancUntyOrd: 'XX' }],
    [{ ...valid, bidPbancUntyNo: '' }], [{ ...valid, pbancPstgDt: '2026/02/30 01:00' }],
    new Response('not JSON'), Response.json({ ErrorCode: 0 })]) {
    const f = fixture([valid], bad);
    await assert.rejects(listNoticePeriodTargets(start, start, f.dependencies));
    assert.equal(f.pages.length, 2);
    assert.deepEqual(f.waits, []);
  }
});
