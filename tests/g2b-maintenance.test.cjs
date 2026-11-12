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
const { parseContractRequestListQuery } = require('../src/entities/contract-request/model/contract-request-list-query');
const { parsePriorSpecListQuery } = require('../src/entities/prior-spec/model/prior-spec-list-query');
const { parseOpeningResultListQuery } = require('../src/entities/opening-result/model/opening-result-list-query');
const { parseContractListQuery } = require('../src/entities/contract/model/contract-list-query');
const { POST: postNotice } = require('../app/api/notices/route');
const { POST: postOpeningResults } = require('../app/api/opening-results/[number]/[revision]/route');
const { GET: getOrderPlanAttachment } = require('../app/api/order-plans/[number]/attachments/[seq]/route');
const { collectNotice } = require('../src/features/collect-g2b/api/notices');
const { getNoticeDisplay, getNoticeAttachmentFiles } = require('../src/entities/notice/model/notice-display');

test('사용자 상세의 목록 복귀 주소는 같은 업무의 홈 조회 조건만 허용한다', () => {
  const { userDetailPath, userListReturnHref } = require('../src/_pages/g2b/config/routes');
  assert.equal(userDetailPath('order-plans', { number: 'PLAN-1', revision: '' }), '/g2b/order-plans/PLAN-1');
  assert.equal(userDetailPath('opening-results', { number: 'R26BK00001', revision: '000' }), '/g2b/opening-results/R26BK00001/000');
  const from = '/?section=notices&q=test&region=A&region=B&sort=title-asc&page=2';
  assert.equal(userListReturnHref('notices', from), from);
  for (const invalid of [undefined, [from], '//example.com/?section=notices', '/admin?section=notices',
    '/?section=contracts', '/?section=notices&section=contracts']) {
    assert.equal(userListReturnHref('notices', invalid), '/?section=notices');
  }
});

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

test('기타 공고는 업무진행을 한 번 조회하고 기타 상세와 공개 첨부를 수집한다', async (t) => {
  const key = { number: 'R26BK01792130', revision: '000' };
  const detail = {
    bidPbancUntyNo: key.number, bidPbancUntyOrd: key.revision,
    untyBidPbancNo: 'R26BM01014144', untyBidPbancOrd: '000',
    prcmBsneSeCd: '09', bidPbancNm: '기타 공고', untyAtchFileNo: group,
  };
  const calls = [];
  mockFetch(t, (path, options) => {
    calls.push(path.split('/').at(-1));
    const body = JSON.parse(options.body);
    if (path.endsWith('/srchWorkPrgs.do'))
      return success({ dlWorkPrgsL: [{ prcmBsneSeCd: '09' }] });
    if (path.endsWith('/selectUntyBidPbancDtlInfo.do')) {
      assert.equal(options.headers.submissionid, 'FIUA027_01_wframe_popupCnts_bidPbancWfrm_sbmBidPbacRqdc');
      assert.equal(body.dlUntyBidPbancM.bidPbancUntyNo, key.number);
      assert.equal(body.dlUntyBidPbancM.bidPbancOrd, key.revision);
      assert.equal(body.dlUntyBidPbancM.prcmBsneSeCd, '09');
      assert.equal(body.dlUntyBidPbancM.untyBidPbancNo, '');
      return success({ dlUntyBidPbancM: detail });
    }
    assert.ok(path.endsWith('/selectUntyAtchFileList.do'), path);
    assert.equal(body.dlUntyAtchFileM.tblNm, 'PBANC_UNTY_BID_PBANC');
    assert.equal(body.dlUntyAtchFileM.colNm, 'UNTY_ATCH_FILE_NO');
    return success({ dlUntyAtchFileL: Array.from({ length: 6 }, (_, index) => ({
      untyAtchFileNo: group, atchFileSqno: index + 1,
      orgnlAtchFileNm: '공고문.pdf', scrnIndtYn: index === 5 ? 'N' : 'Y',
    })) });
  });
  const { notice, openingReport } = await collectNotice(key, '');
  assert.deepEqual(calls, ['srchWorkPrgs.do', 'selectUntyBidPbancDtlInfo.do', 'selectUntyAtchFileList.do']);
  assert.equal(notice.number, key.number);
  assert.deepEqual(notice.payload.dlUntyBidPbancM, detail);
  assert.deepEqual(openingReport.targetRevisions, []);
  assert.deepEqual(getNoticeDisplay(notice.payload, notice.documents, () => undefined).map(({ title }) => title),
    ['공고일반', '입찰집행', '기타', '파일첨부']);
  const files = getNoticeAttachmentFiles(notice.payload, notice.documents);
  assert.equal(files.length, 5);
  assert.deepEqual(Object.fromEntries(new URL(files[0].href).searchParams), {
    bidPbancNo: key.number, bidPbancOrd: key.revision, fileType: '', fileSeq: '1', prcmBsneSeCd: '09',
  });
});

test('기타 공고는 번호·차수가 다르면 저장하지 않고 업무진행 점검 시 상세를 호출하지 않는다', async (t) => {
  const key = { number: 'R26BK01792131', revision: '000' };
  const request = () => new Request('http://localhost/api/notices', {
    method: 'POST', body: JSON.stringify({ ...key, methodCode: '' }),
  });
  for (const override of [{ bidPbancUntyNo: 'R26BM01014144' }, { bidPbancUntyOrd: '001' }]) {
    const fetchMock = mockFetch(t, (path) => {
      if (path.endsWith('/srchWorkPrgs.do'))
        return success({ dlWorkPrgsL: [{ prcmBsneSeCd: '09' }] });
      assert.ok(path.endsWith('/selectUntyBidPbancDtlInfo.do'));
      return success({ dlUntyBidPbancM: {
        bidPbancUntyNo: key.number, bidPbancUntyOrd: key.revision,
        prcmBsneSeCd: '09', bidPbancNm: '기타 공고', ...override,
      } });
    });
    assert.equal((await postNotice(request())).status, 502);
    assert.equal(fetchMock.mock.callCount(), 2);
    fetchMock.mock.restore();
  }
  const fetchMock = mockFetch(t, (path) => {
    assert.ok(path.endsWith('/srchWorkPrgs.do'));
    return maintenancePage();
  });
  assert.equal((await postNotice(request())).status, 503);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(await repository.find(key), null);
});

test('기타 첨부 목록 조회 실패 시 같은 그룹에 대해서만 기존 파일을 보존한다', async (t) => {
  const key = { number: 'R26BK01792132', revision: '000' };
  let currentGroup = group;
  let attachmentsAvailable = true;
  const attachments = { ErrorCode: 0, dlUntyAtchFileL: [] };
  mockFetch(t, (path) => {
    if (path.endsWith('/srchWorkPrgs.do'))
      return success({ dlWorkPrgsL: [{ prcmBsneSeCd: '09' }] });
    if (path.endsWith('/selectUntyBidPbancDtlInfo.do'))
      return success({ dlUntyBidPbancM: {
        bidPbancUntyNo: key.number, bidPbancUntyOrd: key.revision,
        prcmBsneSeCd: '09', bidPbancNm: '기타 공고', untyAtchFileNo: currentGroup,
      } });
    assert.ok(path.endsWith('/selectUntyAtchFileList.do'));
    return attachmentsAvailable ? Response.json(attachments) : new Response(null, { status: 500 });
  });
  const collect = () => postNotice(new Request('http://localhost/api/notices', {
    method: 'POST', body: JSON.stringify({ ...key, methodCode: '' }),
  }));
  assert.equal((await collect()).status, 200);
  attachmentsAvailable = false;
  assert.equal((await collect()).status, 200);
  assert.deepEqual((await repository.find(key)).documents.attachments, attachments);
  currentGroup = '00000000-0000-0000-0000-000000000002';
  assert.equal((await collect()).status, 200);
  assert.equal((await repository.find(key)).documents.attachments, undefined);
});

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

function mockNoticeContracts(t, rows, respondToContract) {
  const requested = [];
  mockFetch(t, (path, options) => {
    if (path.endsWith('/selectItemAnncMngV.do')) return noticeDetail();
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: rows });
    if (path.endsWith('/selectNtcPstList.do')) return success({ dlPstL: [] });
    if (path.endsWith('/srchCtrtDtl.do')) {
      const { ctrtNo, ctrtChgOrd } = JSON.parse(options.body).dlSrchParamM;
      requested.push({ number: ctrtNo, revision: ctrtChgOrd });
      return respondToContract(ctrtNo, ctrtChgOrd);
    }
    assert.fail(path);
  });
  return requested;
}

function linkedContract(number, revision = key.revision) {
  return { bidPbancNo: key.number, bidPbancOrd: revision, ctrtNo: number, ctrtChgOrd: 0 };
}

function contractDetail(number, revision) {
  return success({
    dlCtrtMngLstM: { ctrtNo: number, ctrtChgOrd: revision },
    dlCtrtEtpsLstL: [], dlCtrtEtpsSvsLstL: [], dlCtrtItemLstL: [],
  });
}

test('공고 수집은 연결된 계약 상세를 한 번 저장하고 재수집에서 재사용한다', async (t) => {
  const contract = { number: 'NOTICE-CONTRACT-1', revision: '00' };
  const rows = [linkedContract(contract.number), linkedContract(contract.number)];
  const requested = mockNoticeContracts(t, rows, contractDetail);

  assert.equal((await postNotice(noticeRequest())).status, 200);
  assert.deepEqual((await repository.find(key)).contracts, [contract]);
  assert.deepEqual(repository.findContract(contract)?.detail, {
    ctrtNo: contract.number, ctrtChgOrd: contract.revision,
  });
  assert.equal((await postNotice(noticeRequest())).status, 200);
  assert.deepEqual(requested, [contract]);
});

test('기타 업무진행의 BM 번호·차수로 연결 계약을 찾는다', async (t) => {
  const key = { number: 'R26BK01792133', revision: '000' };
  const contract = { number: 'NOTICE-ETC-CONTRACT', revision: '00' };
  const detail = {
    bidPbancUntyNo: key.number, bidPbancUntyOrd: key.revision,
    untyBidPbancNo: 'R26BM01014144', untyBidPbancOrd: '000',
    prcmBsneSeCd: '09', bidPbancNm: '기타 공고',
  };
  mockFetch(t, (path) => {
    if (path.endsWith('/srchWorkPrgs.do')) {
      const row = { ...linkedContract(contract.number), bidPbancNo: null, bidPbancOrd: null,
        prcmBsneSeCd: '09', untyBidPbancNo: detail.untyBidPbancNo };
      return success({ dlWorkPrgsL: [
        { ...row, untyBidPbancOrd: '001', ctrtNo: 'OTHER-ETC-CONTRACT' },
        { ...row, untyBidPbancOrd: '000' },
      ] });
    }
    if (path.endsWith('/selectUntyBidPbancDtlInfo.do'))
      return success({ dlUntyBidPbancM: detail });
    assert.ok(path.includes('/UntySrch/'), path);
    return contractDetail(contract.number, contract.revision);
  });
  const { notice } = await collectNotice(key, '');
  assert.deepEqual(notice.contracts, [contract]);
  assert.ok(repository.findContract(contract));
});

test('일치하는 계약이 없으면 공고 수집에서 계약 상세를 조회하지 않는다', async (t) => {
  const rows = [];
  const requested = mockNoticeContracts(t, rows, contractDetail);
  for (const additionalRows of [[], [linkedContract('OTHER-REVISION', '001')]]) {
    rows.push(...additionalRows);
    assert.equal((await postNotice(noticeRequest())).status, 200);
    assert.deepEqual((await repository.find(key)).contracts, []);
  }
  assert.deepEqual(requested, []);
});

test('계약 한 건의 조회 실패에도 공고와 정상 계약을 저장하고 실패 이력을 남긴다', async (t) => {
  const failed = { number: 'NOTICE-CONTRACT-FAIL', revision: '00' };
  const saved = { number: 'NOTICE-CONTRACT-OK', revision: '00' };
  mockNoticeContracts(t, [linkedContract(failed.number), linkedContract(saved.number)], (number, revision) =>
    number === failed.number ? new Response(null, { status: 500 }) : contractDetail(number, revision),
  );

  assert.equal((await postNotice(noticeRequest())).status, 200);
  assert.deepEqual((await repository.find(key)).contracts, [failed, saved]);
  assert.equal(repository.findContract(failed), null);
  assert.equal(repository.findContract(saved)?.detail.ctrtNo, saved.number);
  const attempt = repository.collectionAttempts.overview('contracts').failures
    .find(({ number }) => number === failed.number);
  assert.equal(attempt?.status, 'failed');
});

test('연결된 계약 상세의 점검 응답은 공고 저장을 보류한다', async (t) => {
  await repository.save({ ...key, collectedAt, title: '기존 공고', payload: {} });
  // 저장소는 더 최근에 수집한 공고를 보존하므로 점검 직전의 실제 행을 기준으로 비교한다.
  const previous = await repository.find(key);
  assert.ok(previous);
  const number = 'NOTICE-CONTRACT-DEFER';
  mockNoticeContracts(t, [linkedContract(number)], maintenancePage);

  const response = await postNotice(noticeRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'g2b_maintenance');
  assert.deepEqual(await repository.find(key), previous);
  const attempt = repository.collectionAttempts.overview('contracts').failures
    .find((row) => row.number === number);
  assert.equal(attempt?.status, 'deferred');
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

test('사전규격·개찰결과·계약현황은 원본 통화와 업무별 날짜를 사용한다', () => {
  const attempts = repository.collectionAttempts;
  const lists = {
    'prior-specs': [attempts.priorSpecList, parsePriorSpecListQuery],
    'opening-results': [attempts.openingResultList, parseOpeningResultListQuery],
    contracts: [attempts.contractList, parseContractListQuery],
  };
  const page = (section, params) => {
    const [list, parse] = lists[section];
    return list.page(parse(params, list.businesses()));
  };
  for (const [number, code] of [['TESTSPECWON', '01'], ['TESTSPECUSD', '02']]) {
    repository.savePriorSpec({ number, collectedAt, payload: { dlBfSpecM: {
      bfSpecRegNo: number, bfSpecNm: '검증 사전규격', prcmBsneSeCd: code, dmstUntyGrpNm: '검증기관',
      specRlsDt: '2026/11/06 09:00', alotBgtPrspAmt: 500,
    } } });
  }
  const specQuery = { field: 'agency', q: '검증기관', dateTo: '2026-11-06' };
  assert.deepEqual(page('prior-specs', { ...specQuery, budgetFrom: '0' }).rows.map(({ number }) => number), ['TESTSPECWON']);
  assert.deepEqual(page('prior-specs', { ...specQuery, budgetUsdTo: '500' }).rows.map(({ number }) => number), ['TESTSPECUSD']);
  assert.equal(page('prior-specs', { ...specQuery, budgetFrom: '0', budgetUsdTo: '500' }).counts.total, 2);

  const number = 'TESTOPENING';
  const revision = '000';
  for (const openingRevision of ['001', '002']) {
    const query = { number, revision, openingRevision, businessCode: '03', classification: '001' };
    repository.saveOpeningResult({ number, revision, openingRevision, collectedAt, results: [
      { query, detail: { bidInfo: { bidPbancNm: '검증 개찰', dmstNm: '검증기관', realOnbsDt: '2026/11/03 10:00' } } },
      { query: { ...query, classification: '002' }, detail: openingRevision === '001'
        ? { bidInfo: { dmstNm: '검증기관', realOnbsDt: '2026/11/05 10:00' } }
        : { onbsPrnmntDt: '2026/11/09 10:00' } },
    ] });
  }
  const openingQuery = { field: 'number', q: number, business: '03' };
  assert.deepEqual(page('opening-results', { ...openingQuery, dateFrom: '2026-11-05' }).rows.map(({ openingRevision }) => openingRevision), ['001']);
  assert.deepEqual(page('opening-results', { ...openingQuery, dateFrom: '2026-11-06' }).rows, []);
  assert.equal(page('opening-results', { field: 'agency', q: '검증기관' }).counts.total, 2);

  for (const [number, date] of [['TESTCTRT1', '20261109'], ['TESTCTRT2', '20261108']]) {
    repository.saveContract({ number, revision: '00', collectedAt, companies: [], services: [], items: [],
      detail: { ctrtNm: '검증 계약', ctrtView: number, dmstUntyGrpNm: '검증기관', prcmBsneSeCd: '05', frstCtrtDt: date },
    });
  }
  const contractQuery = { field: 'agency', q: '검증기관', business: '05', dateTo: '2026-11-09', sort: 'date-asc' };
  assert.deepEqual(page('contracts', contractQuery).rows.map(({ number }) => number), ['TESTCTRT2', 'TESTCTRT1']);
  assert.deepEqual(page('contracts', { ...contractQuery, status: 'uncollected' }).counts, { total: 2, collected: 2, uncollected: 0 });
});

test('계약요청 세부품명은 표시되는 모든 물품 행에서 검색한 뒤 요청 단위로 페이지를 나눈다', () => {
  const list = repository.collectionAttempts.contractRequestList;
  for (let index = 1; index <= 17; index++) {
    repository.saveContractRequest({
      number: 'TESTREQ' + String(index).padStart(2, '0'), revision: '000', collectedAt,
      detail: {
        bizNm: '검증 요청 ' + index, bizNo: 'RECEIPT' + index, dmstUntyGrpNm: '계약요청 검증기관',
        inptDt: index === 16 ? '2026-11-02 12:00:00' : '2026-11-01 09:00:00',
        prcmBsneAreaCd: index === 17 ? '조070003' : '조070002',
        prcmBsneAreaNm: index === 17 ? '기술용역' : '일반용역',
      },
      items: [{ dtlsPrnm: '다른 물품' }, { dtlsPrnm: '검증 &amp; 물품' }, { dtlsPrnm: '검증 &amp; 물품 추가' }],
    });
  }
  const page = (params) => list.page(parseContractRequestListQuery(params, list.businesses()));
  const item = { field: 'item', q: '검증 & 물품' };
  const first = page(item);
  assert.deepEqual(first.counts, { total: 16, collected: 16, uncollected: 0 });
  assert.equal(first.rows.length, 15);
  assert.equal(first.rows[0].number, 'TESTREQ16');
  assert.deepEqual(page({ ...item, page: '2' }).rows.map(({ number }) => number), ['TESTREQ15']);
  assert.equal(page({ ...item, writtenTo: '2026-11-01', business: '일반용역' }).counts.total, 15);
  assert.equal(page({ ...item, business: '기술용역' }).counts.total, 0);
  assert.equal(page({ field: 'agency', q: '계약요청 검증기관' }).counts.total, 17);
  assert.deepEqual(page({ field: 'number', q: 'RECEIPT16' }).rows.map(({ number }) => number), ['TESTREQ16']);
  assert.deepEqual(page({ field: 'number', q: 'TESTREQ16 / 000' }).rows.map(({ number }) => number), ['TESTREQ16']);
  assert.equal(page({ q: '검증 요청 17', sort: 'title-desc' }).rows[0].number, 'TESTREQ17');
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
            prcmBsneSeCd: index === 1 ? '03' : index === 2 ? '01' : '05',
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
    const businesses = attempts.noticeList.businesses();
    const page = (params) => attempts.noticeList.page(parseNoticeListQuery(params, regions, businesses));
    const numbers = (params) => page(params).rows.map((row) => row.number);
    assert.deepEqual(numbers({ field: 'agency', q: '수요기관', region: ['경기도', '서울특별시'], postedTo: '2026-11-01', submissionFrom: '2026-11-05', budgetTo: '1' }), ['N01']);
    assert.deepEqual(numbers({ q: '& 검증' }), ['N01']);
    assert.deepEqual(numbers({ field: 'number', q: 'missing', status: 'uncollected' }), ['MISSING']);
    assert.deepEqual(numbers({ field: 'number', q: 'N01 - 000' }), ['N01']);
    const regionQuery = { region: ['경기도', '부산광역시'], sort: 'budget-asc' };
    assert.deepEqual(numbers({ ...regionQuery, business: ['03', '01'] }), ['N01', 'N02']);
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
    const query = parseNoticeListQuery({ field: 'agency', q: '기관', region: regions, business: '03', page: '2', sort: 'deadline-asc' }, regions, businesses);
    const href = new URL(noticeListHref('/notices', query), 'http://localhost');
    assert.equal(href.searchParams.get('page'), '2');
    assert.equal(href.searchParams.get('sort'), 'deadline-asc');
    assert.equal(href.searchParams.get('business'), '03');
    assert.deepEqual(href.searchParams.getAll('region'), regions);
    insert.run('R26BK01792130', JSON.stringify({
      title: '기타 공고',
      payload: { dlUntyBidPbancM: {
        prcmBsneSeCd: '09', dmstNm: '기타 수요기관', pbancPstgDt: '202610260900',
        slprRcptBgngDt: '202610270900', slprRcptDdlnDt: '202611040900', bgtAmt: '1000',
      } },
    }));
    const updatedBusinesses = attempts.noticeList.businesses();
    assert.ok(updatedBusinesses.some(({ value, label }) => value === '09' && label === '기타'));
    const etc = attempts.noticeList.page(parseNoticeListQuery({
      business: '09', field: 'agency', q: '기타 수요기관', postedTo: '2026-10-26',
      submissionFrom: '2026-10-27', budgetFrom: '1000', sort: 'deadline-asc',
    }, regions, updatedBusinesses));
    assert.deepEqual(etc.rows.map(({ number, businessCode }) => [number, businessCode]), [['R26BK01792130', '09']]);
  } finally {
    databases.delete(db);
    db.close();
  }
});
