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

const { G2bMaintenanceError, assertNotMaintenance, findMaintenance, maintenanceResponse } = require('../src/shared/api/g2b-maintenance');
const { collectContractRequest, collectOrderPlan, collectPriorSpec } = require('../src/features/collect-notice/api/g2b');
const { getNoticeRepository } = require('../src/entities/notice/server');
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
const repository = getNoticeRepository();
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
});

test('연기공고의 HTTP 200 점검 HTML은 다른 공지 오류보다 우선하며 개찰차수를 보존한다', async (t) => {
  const noticeKey = { number: 'R26BK00002', revision: '000' };
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
