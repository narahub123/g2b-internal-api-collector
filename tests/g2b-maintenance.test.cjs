const assert = require('node:assert/strict');
const { after, mock, test } = require('node:test');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { registerHooks, Module } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const { transformSync } = require('next/dist/build/swc');

// 앱과 같은 SWC로 TypeScript와 JSX를 불러오고 테스트 프로세스에서만 별칭을 해석한다.
for (const extension of ['.ts', '.tsx']) {
  Module._extensions[extension] = (module, filename) => {
    const { code } = transformSync(readFileSync(filename, 'utf8'), {
      filename,
      jsc: { parser: { syntax: 'typescript', tsx: extension === '.tsx' }, transform: { react: { runtime: 'automatic' } } },
      module: { type: 'commonjs' },
    });
    module._compile(code, filename);
  };
}
const aliasHook = registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith('@/') ? join(__dirname, '../src', specifier.slice(2)) : specifier, context);
  },
});

const { G2bMaintenanceError, assertNotMaintenance, findMaintenance, maintenanceResponse } = require('../src/shared/api/g2b/g2b-maintenance');
const { collectContractRequest, collectOrderPlan, collectPriorSpec } = require('../src/features/collect-g2b/server');
const { getG2bRepository } = require('../src/server/g2b/repository');
const { openCollectionAttempts } = require('../src/server/g2b/repository/collection-attempts');
const { noticeListHref, parseNoticeListQuery } = require('../src/entities/notice/model/notice-list-query');
const { orderPlanListHref, parseOrderPlanListQuery } = require('../src/entities/order-plan/model/order-plan-list-query');
const { POST: postNotice } = require('../app/api/notices/route');
const { POST: postOpeningResults } = require('../app/api/opening-results/[number]/[revision]/route');
const { GET: getOrderPlanAttachment } = require('../app/api/order-plans/[number]/attachments/[seq]/route');

// 실제 점검 응답의 제목과 중단 문구를 재현해 HTTP 200에서도 판별하는지 확인한다.
const interruption = '현재 웹서비스가 중단되고 있음을 알려드립니다.';
const maintenanceHtml = `<html><title>시스템 점검 안내</title><h2>시스템점검안내</h2><p>${interruption}</p></html>`;
const maintenancePage = () => new Response(maintenanceHtml);
const success = (data = {}) => Response.json({ ErrorCode: 0, ...data });
const session = () => new Response('<html>정상</html>', { headers: { 'Set-Cookie': 'SESSION=test; Path=/' } });
const group = '00000000-0000-0000-0000-000000000001';
const collectedAt = '2026-11-01T00:00:00.000Z';
const key = { number: 'R26BK00001', revision: '000' };
// 저장소가 작업 디렉터리를 기준으로 DB를 열므로 테스트는 임시 디렉터리로 격리한다.
const priorCwd = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), 'g2b-maintenance-'));
const sqliteExec = DatabaseSync.prototype.exec;
const databases = new Set();
const execMock = mock.method(DatabaseSync.prototype, 'exec', function (sql) {
  databases.add(this);
  return sqliteExec.call(this, sql);
});
process.chdir(tempDir);
const repository = getG2bRepository();
after(() => {
  aliasHook.deregister();
  execMock.mock.restore();
  for (const db of databases) db.close();
  process.chdir(priorCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

function mockFetch(t, respond) {
  return t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).origin, 'https://www.g2b.go.kr');
    return respond(new URL(url).pathname, options);
  });
}

function noticeRequest() {
  return new Request('http://localhost/api/notices', {
    method: 'POST',
    body: JSON.stringify({ ...key, methodCode: '' }),
  });
}

test('수집 이력은 기존 자료와 시도 대상을 합쳐 집계하고 늦게 끝난 시도로 최신 상태를 바꾸지 않는다', () => {
  const target = { section: 'contracts', number: 'HISTORY-1', revision: '00' };
  repository.saveContract({ number: 'LEGACY-1', revision: '00', collectedAt });
  const history = repository.collectionAttempts;
  const older = history.start(target);
  const latest = history.start(target);
  history.finish(latest, 'failed', '조회 실패');
  history.finish(older, 'succeeded');
  const { counts, failures } = history.overview('contracts');
  assert.deepEqual(counts, { total: 2, collected: 1, uncollected: 1 });
  assert.deepEqual(history.counts('contracts'), counts);
  assert.equal(failures[0].id, latest);
  assert.equal(failures[0].hasData, false);
  repository.saveContract({ number: target.number, revision: target.revision, collectedAt });
  assert.equal(history.overview('contracts').failures[0].hasData, true);
  history.finish(history.start(target), 'succeeded');
  assert.equal(history.overview('contracts').failures.length, 0);
});

test('여섯 업무의 미저장 실패를 기록하고 이력의 입력으로 재수집한다', async (t) => {
  const { collectAndSaveNotice, collectContract, collectOpeningResult } = require('../src/features/collect-g2b/server');
  const { POST: retry } = require('../app/api/g2b/collection-attempts/[id]/retry/route');
  const number = 'RETRY-1';
  const notice = { number, revision: '000', methodCode: 'METHOD' };
  const opening = { number, revision: '001', openingRevision: '002' };
  const queries = [{ ...opening, classification: '1', businessCode: '업130020' }];
  let unavailable = true;
  const calls = mockFetch(t, (path, options) => {
    if (unavailable) return new Response(null, { status: 500 });
    if (path === '/') return session();
    const input = JSON.parse(options.body);
    if (path.endsWith('/selectOderPlan.do')) return success({ dlOderPlanM: { oderPlanNo: number } });
    if (path.endsWith('/selectBfSpec.do')) return success({ dlBfSpecM: { bfSpecRegNo: number } });
    if (path.endsWith('/srchDmndSttusSql.do')) return success({ dlTotalSrchL: [{ bizNo: number, bizOrd: 0 }] });
    if (path.endsWith('/srchDmndSttusItemSql.do')) return success({ dlTotalSrchItemL: [] });
    if (path.endsWith('/srchCtrtDtl.do')) return success({
      dlCtrtMngLstM: { ctrtNo: number, ctrtChgOrd: 0 },
      dlCtrtEtpsLstL: [], dlCtrtEtpsSvsLstL: [], dlCtrtItemLstL: [],
    });
    if (path.endsWith('/selectItemAnncMngV.do')) return noticeDetail({ bidPbancNo: number });
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [] });
    if (path.endsWith('/selectOnbsRsltFbid.do')) {
      return success({ result: { bidPrgrs: { ...input.dlSrchOnbsRsltBidInM, prcsRsn: '새 결과' } } });
    }
    if (path.endsWith('/selectRsvePrceInfo.do')) return success({ pbancInfo: input.dlSrchPbancInfoInM, rsvePrceList: [] });
    if (path.endsWith('/selectNtcPstList.do')) return success({ dlPstL: [] });
    assert.fail(path);
  });
  const cases = [
    ['order-plans', () => collectOrderPlan(number, true)],
    ['prior-specs', () => collectPriorSpec(number, true)],
    ['contract-requests', () => collectContractRequest({ number, revision: '000' }, true)],
    ['contracts', () => collectContract({ number, revision: '00' }, true)],
    ['notices', () => collectAndSaveNotice(notice)],
    ['opening-results', () => collectOpeningResult(opening, queries, true)],
  ];
  const request = new Request('http://localhost', { method: 'POST' });
  for (const [section, collect] of cases) {
    unavailable = true;
    await assert.rejects(collect());
    const history = repository.collectionAttempts;
    const failed = history.overview(section).failures.find((row) => row.number === number);
    assert.equal(failed.status, 'failed', section);
    assert.equal(failed.hasData, false, section);
    if (section === 'notices') assert.equal(history.retryTarget(failed.id).methodCode, notice.methodCode);
    if (section === 'opening-results') assert.deepEqual(history.retryTarget(failed.id).queries, queries);

    unavailable = false;
    const context = { params: Promise.resolve({ id: String(failed.id) }) };
    const response = await retry(request, context);
    assert.equal(response.status, 204, response.status === 204 ? section : await response.text());
    const updated = history.overview(section);
    assert.deepEqual(history.counts(section), updated.counts, section);
    assert.ok(updated.saved.some((row) => row.number === number), section);
    assert.ok(!updated.failures.some((row) => row.number === number), section);
    const count = calls.mock.callCount();
    assert.equal((await retry(request, context)).status, 409, section);
    assert.equal(calls.mock.callCount(), count, section);
  }
});

test('동시 수집 요청은 이력과 외부 요청을 공유하고 진행 중인 시도를 다시 실행하지 않는다', async (t) => {
  const { collectContract } = require('../src/features/collect-g2b/server');
  const { POST: retry } = require('../app/api/g2b/collection-attempts/[id]/retry/route');
  const target = { number: 'SHARED-1', revision: '00' };
  const upstream = Promise.withResolvers();
  const calls = mockFetch(t, () => upstream.promise);
  const first = collectContract(target, true);
  const second = collectContract(target, true);
  const pending = repository.collectionAttempts.overview('contracts').failures.find(({ number }) => number === target.number);
  assert.equal(pending.status, 'pending');
  assert.equal((await retry(new Request('http://localhost', { method: 'POST' }), {
    params: Promise.resolve({ id: String(pending.id) }),
  })).status, 409);
  assert.equal(calls.mock.callCount(), 1);
  upstream.resolve(maintenancePage());
  await Promise.all([assert.rejects(first, G2bMaintenanceError), assert.rejects(second, G2bMaintenanceError)]);
  const deferred = repository.collectionAttempts.overview('contracts').failures.find(({ number }) => number === target.number);
  assert.equal(deferred.id, pending.id);
  assert.equal(deferred.status, 'deferred');
});

function noticeDetail(extra = {}) {
  return success({ dmItemMap: {
    bidPbancNo: key.number, bidPbancOrd: key.revision, bidPbancNm: '새 공고',
    ...extra,
  } });
}

test('명시적인 점검 화면만 판별한다', () => {
  assert.throws(() => assertNotMaintenance(maintenanceHtml), G2bMaintenanceError);
  assert.throws(() => assertNotMaintenance(`<h1>시스템\n <span>점검</span>&nbsp;안내</h1><p>${interruption}</p>`), G2bMaintenanceError);
  for (const body of [
    '', JSON.stringify({ message: maintenanceHtml }),
    '<title>공지사항</title><p>시스템 점검 안내: 내일 점검 예정</p>',
    '<title>오류</title>', '<title>시스템 점검 안내</title>',
    `<!-- ${maintenanceHtml} -->`,
    `<title>시스템 점검 안내</title><script>${interruption}</script>`,
    `<script>"<h2>시스템점검안내</h2>"</script><p>${interruption}</p>`,
  ]) assert.doesNotThrow(() => assertNotMaintenance(body));
});

test('중첩된 점검만 503으로 반환한다', async () => {
  const error = new G2bMaintenanceError();
  const nested = new AggregateError([new Error('timeout'), new Error('wrapped', { cause: error })]);
  assert.equal(findMaintenance(nested), error);
  assert.equal(findMaintenance(new Error('timeout')), undefined);
  const response = maintenanceResponse(nested);
  assert.equal(response?.status, 503);
  assert.deepEqual(await response?.json(), { error: error.message, code: 'g2b_maintenance' });
});

test('공고 부가 조회 점검은 기존 행을 보존하고 다음 게시글 조회를 중단한다', async (t) => {
  const previous = { ...key, collectedAt, title: '기존 공고', payload: {} };
  await repository.save(previous);
  const calls = mockFetch(t, (path) => {
    if (path.endsWith('/selectItemAnncMngV.do')) return noticeDetail();
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [] });
    if (path.endsWith('/selectNtcPstList.do')) return success({ dlPstL: [
      { bbsNo: 'B', pstNo: '1' }, { bbsNo: 'B', pstNo: '2' },
    ] });
    if (path === '/') return session();
    if (path.endsWith('/selectPst.do')) return maintenancePage();
    assert.fail(path);
  });
  const response = await postNotice(noticeRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'g2b_maintenance');
  assert.deepEqual(await repository.find(key), previous);
  assert.equal(calls.mock.calls.filter(({ arguments: [url] }) => new URL(url).pathname.endsWith('/selectPst.do')).length, 1);
});

test('일반 API 오류는 기존 502로 처리하고 정상 공고는 저장한다', async (t) => {
  const calls = mockFetch(t, () => new Response(null, { status: 503 }));
  for (const respond of [
    () => new Response(null, { status: 503 }),
    () => new Response('Forbidden', { status: 403 }),
    () => { throw new DOMException('timeout', 'TimeoutError'); },
  ]) {
    calls.mock.mockImplementation(respond);
    assert.equal((await postNotice(noticeRequest())).status, 502);
  }
  calls.mock.mockImplementation(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/selectItemAnncMngV.do')) return noticeDetail();
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [] });
    if (path.endsWith('/selectNtcPstList.do')) return success({ dlPstL: [] });
    assert.fail(path);
  });
  assert.equal((await postNotice(noticeRequest())).status, 200);
  const saved = await repository.find(key);
  assert.equal(saved.title, '새 공고');
  assert.notEqual(saved.collectedAt, collectedAt);
});

test('계약요청 상세 점검 이후에는 다음 품목 페이지를 조회하지 않는다', async (t) => {
  const contractKey = { number: 'REQ1', revision: '000' };
  const previous = { ...contractKey, collectedAt, detail: {}, items: [] };
  repository.saveContractRequest(previous);
  let itemCalls = 0;
  mockFetch(t, async (path) => {
    if (path.endsWith('/srchDmndSttusSql.do')) return maintenancePage();
    assert.ok(path.endsWith('/srchDmndSttusItemSql.do'), path);
    itemCalls++;
    await new Promise(setImmediate);
    return success({ dlTotalSrchItemL: Array.from({ length: 10 }, (_, index) => ({
      ctrtDmndRcptNo: contractKey.number, ctrtDmndRcptOrd: '0', index,
    })) });
  });
  await assert.rejects(collectContractRequest(contractKey, true), G2bMaintenanceError);
  assert.equal(itemCalls, 1);
  assert.deepEqual(repository.findContractRequest(contractKey), previous);
});

test('발주계획과 사전규격의 첨부 점검은 저장과 대기 중인 재수집을 보류한다', async (t) => {
  let attachmentCalls = 0;
  let useMaintenance = true;
  mockFetch(t, (path, options) => {
    if (path === '/') return session();
    const number = JSON.parse(options.body).dlParamM;
    if (path.endsWith('/selectOderPlan.do')) return success({
      dlOderPlanM: { oderPlanNo: number.oderPlanNo, oderPlanUntyAtchFileNo: group },
    });
    if (path.endsWith('/selectBfSpec.do')) return success({
      dlBfSpecM: { bfSpecRegNo: number.bfSpecRegNo, untyAtchFileNo: group },
    });
    assert.ok(path.endsWith('/selectUntyAtchFileList.do'), path);
    attachmentCalls++;
    return useMaintenance ? maintenancePage() : new Response(null, { status: 500 });
  });
  const pending = collectOrderPlan('PLAN1');
  const queued = collectOrderPlan('PLAN1', true);
  await Promise.all([
    assert.rejects(pending, G2bMaintenanceError),
    assert.rejects(queued, G2bMaintenanceError),
  ]);
  assert.equal(attachmentCalls, 1);
  assert.equal(repository.findOrderPlan('PLAN1'), null);
  await assert.rejects(collectPriorSpec('SPEC1'), G2bMaintenanceError);
  assert.equal(repository.findPriorSpec('SPEC1'), null);

  useMaintenance = false;
  await assert.rejects(collectOrderPlan('PLAN1'), /실패/);
  await assert.rejects(collectPriorSpec('SPEC1'), /실패/);
  const plan = repository.findOrderPlan('PLAN1');
  const spec = repository.findPriorSpec('SPEC1');
  assert.ok(plan && spec);
  assert.equal(plan.attachments, undefined);
  assert.equal(spec.attachments, undefined);

  useMaintenance = true;
  await assert.rejects(collectOrderPlan('PLAN1', true), G2bMaintenanceError);
  await assert.rejects(collectPriorSpec('SPEC1', true), G2bMaintenanceError);
  assert.deepEqual(repository.findOrderPlan('PLAN1'), plan);
  assert.deepEqual(repository.findPriorSpec('SPEC1'), spec);
});

test('개찰차수의 점검은 부분 저장을 보류하고 일반 오류는 성공 자료를 저장한다', async (t) => {
  const openingKey = { ...key, openingRevision: '001' };
  const previous = {
    ...openingKey, collectedAt,
    results: ['1', '2'].map((classification) => ({
      query: { ...openingKey, classification, businessCode: '업130020' },
      detail: { prcsRsn: '기존 결과' },
    })),
  };
  repository.saveOpeningResult(previous);
  let useMaintenance = true;
  mockFetch(t, (path, options) => {
    if (path === '/') return session();
    if (path.endsWith('/selectOnbsRsltFbid.do')) {
      const input = JSON.parse(options.body).dlSrchOnbsRsltBidInM;
      if (input.bidClsfNo === '2') return useMaintenance ? maintenancePage() : new Response(null, { status: 500 });
      return success({ result: { bidPrgrs: { ...input, prcsRsn: '새 결과' } } });
    }
    if (path.endsWith('/selectRsvePrceInfo.do')) return new Response(null, { status: 500 });
    return success({ dlPstL: [] });
  });
  const request = new Request('http://localhost', { method: 'POST' });
  const context = { params: Promise.resolve(key) };
  const deferred = await postOpeningResults(request, context);
  assert.equal(deferred.status, 503);
  assert.deepEqual((await deferred.json()).failedRevisions, ['001']);
  assert.deepEqual(repository.findOpeningResult(openingKey), previous);

  useMaintenance = false;
  t.mock.method(console, 'error', () => {});
  assert.equal((await postOpeningResults(request, context)).status, 502);
  const updated = repository.findOpeningResult(openingKey);
  assert.notEqual(updated.collectedAt, collectedAt);
  assert.equal(updated.results.find(({ query }) => query.classification === '1').detail.prcsRsn, '새 결과');
  assert.equal(updated.results.find(({ query }) => query.classification === '2').detail.prcsRsn, '기존 결과');
  const failure = repository.collectionAttempts.overview('opening-results').failures.find(
    ({ number, revision, openingRevision }) =>
      number === openingKey.number && revision === openingKey.revision && openingRevision === openingKey.openingRevision,
  );
  assert.equal(failure.status, 'failed');
  assert.equal(failure.hasData, true);
});

test('연기공고의 HTTP 200 점검 HTML은 다른 공지 오류보다 우선하며 개찰차수를 보존한다', async (t) => {
  const noticeKey = { number: 'R26BK00002', revision: '000' };
  await repository.save({ ...noticeKey, title: '저장된 공고', collectedAt, payload: {} });
  const openingKey = { ...noticeKey, openingRevision: '001' };
  const query = { ...openingKey, classification: '1', businessCode: '업130020' };
  const previous = {
    ...openingKey, collectedAt, results: [{ query, detail: { prcsRsn: '기존 결과' } }],
  };
  repository.saveOpeningResult(previous);
  let postponementCalls = 0;
  mockFetch(t, async (path, options) => {
    if (path === '/') return session();
    const input = JSON.parse(options.body);
    if (path.endsWith('/selectOnbsRsltFbid.do')) {
      return success({ result: { bidPrgrs: { ...input.dlSrchOnbsRsltBidInM, prcsRsn: '새 결과' } } });
    }
    if (path.endsWith('/selectRsvePrceInfo.do')) {
      return success({ pbancInfo: input.dlSrchPbancInfoInM, rsvePrceList: [] });
    }
    assert.ok(path.endsWith('/selectNtcPstList.do'), path);
    // 같은 API 경로에서 1182는 연기공고, 1727은 분류별 개찰 공지에 해당한다.
    if (input.dlPstM.clsfPritmSqno === '1182') {
      postponementCalls++;
      // 일반 오류가 먼저 완료돼도 나중에 확인한 점검이 우선해야 한다.
      await new Promise(setImmediate);
      return maintenancePage();
    }
    assert.equal(input.dlPstM.clsfPritmSqno, '1727');
    return new Response(null, { status: 500 });
  });

  const response = await postOpeningResults(new Request('http://localhost', { method: 'POST' }), {
    params: Promise.resolve(noticeKey),
  });
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.code, 'g2b_maintenance');
  assert.deepEqual(result.failedRevisions, ['001']);
  assert.equal(postponementCalls, 1);
  assert.deepEqual(repository.findOpeningResult(openingKey), previous);
});

test('미저장 공고의 전체 수집 결과를 개찰 요청에 공유하고 차수별 성공과 실패를 반환한다', async (t) => {
  const fetchedNotices = [];
  const fetchedOpenings = [];
  let failSecond = true;
  t.mock.method(console, 'error', () => {});
  mockFetch(t, async (path, options) => {
    if (path === '/') return session();
    const input = JSON.parse(options.body);
    if (path.endsWith('/selectItemAnncMngV.do')) {
      const { bidPbancNo, bidPbancOrd, scsbdMthdCd } = input.dmItemMap;
      fetchedNotices.push({ bidPbancNo, scsbdMthdCd });
      await new Promise(setImmediate);
      return success({
        dmItemMap: { bidPbancNo, bidPbancOrd, bidPbancNm: '새 공고', prcmBsneSeCd: '03' },
        dlBidBasePgstL: bidPbancNo === 'OPEN-NONE' ? [] : ['001', '002'].map((bidPrgrsOrd) => ({
          bidPbancNo, bidPbancOrd, bidPrgrsOrd, bidClsfNo: '1', bidPgstCd: '입160005',
        })),
      });
    }
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [] });
    if (path.endsWith('/selectNtcPstList.do')) return success({ dlPstL: [] });
    if (path.endsWith('/selectRsvePrceInfo.do')) {
      return success({ pbancInfo: input.dlSrchPbancInfoInM, rsvePrceList: [] });
    }
    assert.ok(path.endsWith('/selectOnbsRsltFbid.do'), path);
    const detail = input.dlSrchOnbsRsltBidInM;
    fetchedOpenings.push(detail.bidPrgrsOrd);
    if (detail.bidPbancNo === 'OPEN-DEFER' && detail.bidPrgrsOrd === '002') return maintenancePage();
    if (failSecond && detail.bidPrgrsOrd === '002') return new Response(null, { status: 500 });
    return success({ result: { bidPrgrs: detail } });
  });
  const requestOpening = (number, body) => postOpeningResults(
    new Request('http://localhost', { method: 'POST', body }),
    { params: Promise.resolve({ number, revision: '000' }) },
  );
  const body = JSON.stringify({ methodCode: 'METHOD' });
  const responses = await Promise.all([requestOpening('OPEN-PARTIAL', body), requestOpening('OPEN-PARTIAL', body)]);
  for (const response of responses) {
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.noticeSaved, true);
    assert.deepEqual(result.targetRevisions, ['001', '002']);
    assert.deepEqual(result.succeededRevisions, ['001']);
    assert.deepEqual(result.failedRevisions, ['002']);
  }
  assert.deepEqual(fetchedNotices, [{ bidPbancNo: 'OPEN-PARTIAL', scsbdMthdCd: 'METHOD' }]);
  assert.deepEqual(fetchedOpenings.sort(), ['001', '002']);
  assert.ok(await repository.find({ number: 'OPEN-PARTIAL', revision: '000' }));

  failSecond = false;
  assert.equal((await requestOpening('OPEN-PARTIAL')).status, 200);
  assert.equal(fetchedNotices.length, 1);
  assert.deepEqual(fetchedOpenings.slice(2).sort(), ['001', '002']);
  assert.equal((await requestOpening('OPEN-SUCCESS')).status, 200);

  const absent = await requestOpening('OPEN-NONE');
  assert.equal(absent.status, 404);
  assert.equal((await absent.json()).noticeSaved, true);
  const deferred = await requestOpening('OPEN-DEFER');
  assert.equal(deferred.status, 503);
  const result = await deferred.json();
  assert.equal(result.noticeSaved, false);
  assert.deepEqual(result.succeededRevisions, ['001']);
  assert.deepEqual(result.failedRevisions, ['002']);
  assert.equal(await repository.find({ number: 'OPEN-DEFER', revision: '000' }), null);
  assert.equal((await requestOpening('OPEN-BAD', '{"methodCode":2}')).status, 400);
  assert.ok(!fetchedNotices.some(({ bidPbancNo }) => bidPbancNo === 'OPEN-BAD'));
});

test('세션 발급과 다운로드 메타데이터의 점검을 감지한다', async (t) => {
  const calls = mockFetch(t, () => maintenancePage());
  await assert.rejects(collectOrderPlan('SESSION1'), G2bMaintenanceError);
  assert.equal(calls.mock.callCount(), 1);

  repository.saveOrderPlan({
    number: 'DOWNLOAD1', collectedAt,
    payload: { dlOderPlanM: { oderPlanUntyAtchFileNo: group } },
    attachments: { dlUntyAtchFileL: [{
      untyAtchFileNo: group, atchFileSqno: 1, orgnlAtchFileNm: '공개.pdf', scrnIndtYn: 'Y',
    }] },
  });
  const response = await getOrderPlanAttachment(new Request('http://localhost'), {
    params: Promise.resolve({ number: 'DOWNLOAD1', seq: '1' }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'g2b_maintenance');
  assert.equal(calls.mock.callCount(), 2);
});

test('발주계획은 업무별 원화 예산과 검색 조건을 전체 결과에 적용한 뒤 페이지를 조회한다', () => {
  const { collectionAttempts: attempts } = repository;
  const plans = attempts.orderPlanList;
  const agency = '발주계획 검증기관';
  const save = (number, detail) => repository.saveOrderPlan({
    number, collectedAt, payload: { dlOderPlanM: { oderInstNm: agency, ...detail } },
  });
  for (let index = 1; index <= 16; index++) {
    save('TESTPLAN' + String(index).padStart(2, '0'), {
      bizNm: '물품 검증', prcmBsneSeCd: '01', prchsPrnmntAmt: 100,
      srvBgtAmt: 0, releaseDt: '2026/11/01 09:00',
    });
  }
  save('TESTPLANSERVICE', { bizNm: '용역 검증', prcmBsneSeCd: '03', prchsPrnmntAmt: 0, srvBgtAmt: 150, releaseDt: '202611011000' });
  save('TESTPLANFOREIGN', { itemNm: '외자 &amp; 품명', prcmBsneSeCd: '02', prchsPrnmntAmt: 100, frncCvrsPrchsPrnmntAmt: 110 });
  save('TESTPLANCONSTRUCTION', { bizNm: '공사 검증', prcmBsneSeCd: '07', newLotmSeCd: '신120002', oderSumAmt: 0, tlbkpngAmt: 120, releaseDt: '2026/11/01 08:00' });
  const failed = attempts.start({ section: 'order-plans', number: 'TESTPLANMISSING' });
  attempts.finish(failed, 'failed', '테스트 실패');
  const businesses = plans.businesses();
  const query = parseOrderPlanListQuery({ field: 'agency', q: agency, business: ['01', '03', '07'], releasedFrom: '2026-11-01', releasedTo: '2026-11-01', budgetFrom: '100', budgetTo: '150' }, businesses);
  const first = plans.page(query);
  assert.deepEqual(first.counts, { total: 18, collected: 18, uncollected: 0 });
  assert.equal(first.totalPages, 2);
  assert.equal(first.rows[0].number, 'TESTPLANSERVICE');
  assert.equal(first.rows.length, 15);
  assert.deepEqual(plans.page({ ...query, page: 2 }).rows.map((row) => row.number), ['TESTPLAN15', 'TESTPLAN16', 'TESTPLANCONSTRUCTION']);
  assert.deepEqual(plans.page({ ...query, status: 'uncollected' }).counts, first.counts);
  const missing = plans.page(parseOrderPlanListQuery({ field: 'number', q: 'testplanmissing', status: 'uncollected' }, businesses));
  assert.deepEqual(missing.rows.map((row) => row.number), ['TESTPLANMISSING']);
  const title = parseOrderPlanListQuery({ q: '외자 & 품명', sort: 'title-asc' }, businesses);
  assert.deepEqual(plans.page(title).rows.map((row) => row.number), ['TESTPLANFOREIGN']);
  assert.deepEqual(plans.page({ ...title, filters: { budget: { from: 0 } } }).rows, []);
  const href = new URL(orderPlanListHref('/order-plans', { ...query, page: 2 }), 'http://localhost');
  assert.equal(href.searchParams.get('page'), '2');
  assert.deepEqual(new Set(href.searchParams.getAll('business')), new Set(['01', '03', '07']));
});

test('입찰공고 조건은 페이지 조회 전에 적용하며 협정서 일정과 숨겨진 지역을 제외한다', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE notices (number TEXT, revision TEXT, collected_at TEXT, data TEXT);
      CREATE TABLE order_plans (number TEXT, collected_at TEXT, data TEXT);
      CREATE TABLE prior_specs (number TEXT, collected_at TEXT, data TEXT);
      CREATE TABLE contract_requests (number TEXT, revision TEXT, collected_at TEXT, data TEXT);
      CREATE TABLE contracts (number TEXT, revision TEXT, collected_at TEXT, data TEXT);
      CREATE TABLE opening_results (number TEXT, revision TEXT, opening_revision TEXT, collected_at TEXT, data TEXT);
    `);
    const attempts = openCollectionAttempts(db);
    const insert = db.prepare("INSERT INTO notices VALUES (?, '000', '2026-11-01', ?)");
    for (let index = 1; index <= 23; index++) {
      const number = 'N' + String(index).padStart(2, '0');
      insert.run(number, JSON.stringify({
        title: index === 1 ? '공고 &#38; 검증' : number,
        payload: {
          dmItemMap: {
            dmstUntyGrpNm: index === 1 ? '테스트 수요기관' : '다른 기관',
            pbancPstgDt: '2026/11/01 09:00:00',
            alotBgtAmt: index,
            rgnLmtYn: [1, 4, 5].includes(index) ? 'Y' : index === 3 ? null : 'N',
            rgnLmtYnNm: index === 2 ? '해당없음' : '공고서참조',
            rgnLmtCn: index === 1 ? '[서울특별시][경기도]' : index === 4 ? '[부산광역시]' : index === 5 ? null : '[숨겨진 지역]',
          },
          dmItemList1: [
            { startDtNm: 'BIDPBANC_SLPRRCPTBGNGDT', startDt: '2026/11/02 09:00:00', endDtNm: 'PBANCJINTSYDD_JSAGRSBMSNDDLNDT' },
            { startDt: '202611051030', endDt: '2026/11/06 11:00:00', endDtNm: 'BIDPBANC_SLPRRCPTDDLNDT' },
          ],
        },
      }));
    }
    const failed = attempts.start({ section: 'notices', number: 'MISSING', revision: '000', methodCode: '' });
    attempts.finish(failed, 'failed', '테스트 실패');
    const regions = attempts.noticeList.regions();
    assert.deepEqual(regions, ['경기도', '부산광역시', '서울특별시']);
    const page = (params) => attempts.noticeList.page(parseNoticeListQuery(params, regions));
    const numbers = (params) => page(params).rows.map((row) => row.number);
    assert.deepEqual(numbers({ field: 'agency', q: '수요기관', region: ['경기도', '서울특별시'], postedTo: '2026-11-01', submissionFrom: '2026-11-05', budgetTo: '1' }), ['N01']);
    assert.deepEqual(numbers({ q: '& 검증' }), ['N01']);
    assert.deepEqual(numbers({ field: 'number', q: 'missing', status: 'uncollected' }), ['MISSING']);
    assert.deepEqual(numbers({ field: 'number', q: 'N01 - 000' }), ['N01']);
    const regionQuery = { region: ['경기도', '부산광역시'], sort: 'budget-asc' };
    assert.deepEqual(numbers(regionQuery), ['N01', 'N02', 'N04']);
    const noUncollected = page({ ...regionQuery, status: 'uncollected', page: '2' });
    assert.deepEqual(noUncollected.counts, { total: 3, collected: 3, uncollected: 0 });
    assert.deepEqual(noUncollected.rows, []);
    assert.equal(noUncollected.totalPages, 0);
    for (const status of ['total', 'collected', 'uncollected']) {
      assert.deepEqual(page({ status, field: 'number', q: '000' }).counts, { total: 24, collected: 23, uncollected: 1 });
      assert.deepEqual(page({ status, field: 'number', q: '존재하지 않음' }).counts, { total: 0, collected: 0, uncollected: 0 });
    }
    assert.deepEqual(numbers({ submissionTo: '2026-11-02' }), []);
    assert.deepEqual(numbers({ sort: 'budget-desc', page: '2' }), ['N08', 'N07', 'N06', 'N05', 'N04', 'N03', 'N02', 'N01', 'MISSING']);
    assert.equal(page({ page: '999' }).page, 2);
    for (const sort of ['posted-asc', 'submission-asc', 'deadline-desc', 'title-asc', 'budget-asc']) {
      assert.equal(page({ sort }).rows.length, 15);
    }
    const query = parseNoticeListQuery({ field: 'agency', q: '기관', region: regions, page: '2', sort: 'deadline-asc' }, regions);
    const href = new URL(noticeListHref('/notices', query), 'http://localhost');
    assert.equal(href.searchParams.get('page'), '2');
    assert.equal(href.searchParams.get('sort'), 'deadline-asc');
    assert.deepEqual(href.searchParams.getAll('region'), regions);
  } finally {
    databases.delete(db);
    db.close();
  }
});
