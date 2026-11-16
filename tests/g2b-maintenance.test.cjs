const assert = require('node:assert/strict');
const { after, beforeEach, mock, test } = require('node:test');
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

test('관련공고는 상세 응답의 번호와 차수를 원본 순서로 연관정보에 표시한다', () => {
  const display = (relaPbancNo) => getNoticeDisplay({ dmItemMap: { relaPbancNo } }, undefined, () => undefined)
    .find(({ title }) => title === '연관정보');

  assert.deepEqual(display('R26BK01815045-001,R26BK01815045-000').relatedNotices, [
    { number: 'R26BK01815045', revision: '001' },
    { number: 'R26BK01815045', revision: '000' },
  ]);
  assert.deepEqual(display('R26BK01795517-000').relatedNotices, [
    { number: 'R26BK01795517', revision: '000' },
  ]);
  assert.equal(display(' , , '), undefined);
  assert.equal(display(undefined), undefined);
});

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
const key = { number: 'R26BK00000001', revision: '000' };
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
const { executeNoticeJob } = require('../src/features/collect-g2b/server');
const queue = repository.noticeQueue;

beforeEach(() => {
  const db = new DatabaseSync(join(tempDir, '.data', 'notices.sqlite'));
  sqliteExec.call(db, 'DELETE FROM g2b_notice_walk_visits; DELETE FROM g2b_notice_walks; DELETE FROM g2b_notice_jobs; UPDATE g2b_notice_queue SET manual = 0, maintenance = 0');
  db.close();
});

async function drainNoticeJobs() {
  for (let job; (job = queue.claim(Date.now())); ) {
    queue.finish(job.id, await executeNoticeJob(job), Date.now());
  }
}

async function acceptedJob(response) {
  assert.equal(response.status, 202);
  const { jobId } = await response.json();
  await drainNoticeJobs();
  return queue.get(jobId);
}

async function submitNotice(request) {
  return acceptedJob(await postNotice(request));
}

async function collectSingleNotice(input, allowPartial = false) {
  const [id] = queue.enqueue([input], true);
  const job = queue.claim(Date.now());
  assert.equal(job.id, id);
  const outcome = await executeNoticeJob(job);
  queue.finish(id, outcome, Date.now());
  if (!allowPartial && outcome.kind !== 'success') throw new Error(outcome.error);
}
after(() => {
  aliasHook.deregister();
  execMock.mock.restore();
  for (const db of databases) db.close();
  process.chdir(priorCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

function mockFetch(t, respond, noticeList = () => []) {
  return t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).origin, 'https://www.g2b.go.kr');
    const path = new URL(url).pathname;
    if (path.endsWith('/selectBidPbacScrollTypeList.do')) return success({ result: noticeList(JSON.parse(options.body).dlBidPbancLstM) });

    return respond(path, options);
  });
}

test('통합공고는 목록에서 원본 차수를 복원해 기존 실패 이력의 저장 키로 재수집한다', async (t) => {
  const number = 'E012608144';
  const input = { number, revision: '000', methodCode: '' };
  const row = { bidPbancUntyNo: number, bidPbancUntyOrd: '00', untyBidPbancRegTyCd: '통050001', prcmBsneSeCd: '03' };
  let listed = [row];
  let detail = { ...row, bidPbancNm: '통합공고' };
  mockFetch(t, (path, options) => {
    if (path === '/') return session();
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [] });
    assert.ok(path.endsWith('/selectUntyBidPbancDtlInfo.do'), path);
    const map = JSON.parse(options.body).dlUntyBidPbancM;
    assert.deepEqual([map.bidPbancUntyNo, map.bidPbancUntyOrd, map.prcmBsneSeCd], [number, '00', '03']);
    return success({ dlUntyBidPbancM: detail });
  }, ({ bidPbancNo, startIndex }) => bidPbancNo === number && startIndex === 1 ? listed : []);
  listed = [row, row];
  await assert.rejects(collectNotice(input, ''), /여러 개/);
  listed = [row];
  for (const invalid of [{}, { ...detail, bidPbancUntyOrd: '000' }]) {
    detail = invalid;
    await assert.rejects(collectNotice(input, ''), /상세 응답/);
  }
  detail = { ...row, bidPbancNm: '통합공고' };
  const history = repository.collectionAttempts;
  const id = history.start({ section: 'notices', ...input });
  history.finish(id, 'failed');
  const { POST: retry } = require('../app/api/g2b/collection-attempts/[id]/retry/route');
  const response = await retry(new Request('http://localhost', { method: 'POST' }), {
    params: Promise.resolve({ id: String(id) }),
  });
  assert.equal(response.status, 202);
  const job = await acceptedJob(response);
  assert.equal(job.status, 'succeeded');
  assert.deepEqual((await repository.find(input)).payload.dlUntyBidPbancM, detail);
  assert.equal(await repository.find({ number, revision: '00' }), null);
});

test('코드 99는 요청 번호와 일치하는 사전규격 상세만 저장한다', async (t) => {
  const number = 'TESTSPEC99';
  let detail = { bfSpecRegNo: number, bfSpecNm: '사전규격 테스트' };
  mockFetch(t, (path) => {
    if (path === '/') return session();
    if (path.endsWith('/selectBfSpec.do')) {
      return Response.json({ ErrorCode: '99', ErrorMsg: '정상적으로 조회되었습니다.', dlBfSpecM: detail });
    }
    assert.ok(path.endsWith('/selectOderPlan.do'));
    return Response.json({ ErrorCode: '99', dlOderPlanM: { oderPlanNo: number } });
  });

  await collectPriorSpec(number);
  const saved = repository.findPriorSpec(number);
  assert.deepEqual(saved.payload.dlBfSpecM, detail);
  assert.equal(saved.payload.ErrorCode, '99');

  for (const invalidDetail of [undefined, { bfSpecRegNo: 'OTHER' }]) {
    detail = invalidDetail;
    await assert.rejects(collectPriorSpec(number, true));
    assert.deepEqual(repository.findPriorSpec(number), saved);
  }
  await assert.rejects(collectOrderPlan(number));
  assert.equal(repository.findOrderPlan(number), null);
});

test('발주계획 미존재 422는 공고를 정상 저장하고 재수집 성공 시 상태를 해제한다', async (t) => {
  const noticeKey = { number: 'R26BK01828764', revision: '000' };
  const number = 'R26DD20928824';
  const detail = {
    bidPbancNo: noticeKey.number, bidPbancOrd: noticeKey.revision, bidPbancNm: '발주계획 미존재 공고',
    oderPlanUntyNo: number,
  };
  let status = 422;
  let message = '발주계획정보가 존재하지 않습니다.';
  mockFetch(t, (path) => {
    if (path === '/') return session();
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [] });
    if (path.endsWith('/selectNtcPstList.do')) return success({ dlPstL: [] });
    if (path.endsWith('/selectItemAnncMngV.do')) return success({ dmItemMap: detail });
    assert.ok(path.endsWith('/selectOderPlan.do'), path);
    return status === 200 && !message
      ? success({ dlOderPlanM: { oderPlanNo: number } })
      : Response.json({ ErrorCode: -1, ErrorMsg: message }, { status });
  });

  const { POST } = require('../app/api/order-plans/[number]/route');
  const history = repository.collectionAttempts;
  const countsBefore = history.counts('order-plans');
  const listByNumber = (status, q = number) => history.orderPlanList.page(parseOrderPlanListQuery({
    field: 'number', q, status, page: '2',
  }, []));
  const collectDirectly = () => POST(new Request('http://localhost'), { params: Promise.resolve({ number }) });
  const response = await collectDirectly();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { number, status: 'unprocessable-entity' });
  assert.equal(listByNumber('uncollected').counts.uncollected, 1);
  const recollect = () => collectSingleNotice({ ...noticeKey, methodCode: '' });
  await recollect();
  const saved = await repository.find(noticeKey);
  assert.equal(saved.orderPlanStatus, 'unprocessable-entity');
  assert.deepEqual(saved.payload.dmItemMap, detail);
  assert.equal(repository.findOrderPlan(number), null);
  assert.ok(!repository.collectionAttempts.overview('order-plans').failures.some((row) => row.number === number));
  await repository.save({ ...saved, revision: '001' });
  assert.deepEqual(history.counts('order-plans'), countsBefore);
  assert.deepEqual(history.overview('order-plans').counts, countsBefore);
  for (const status of ['total', 'uncollected']) {
    const result = listByNumber(status);
    assert.deepEqual(result.counts, { total: 0, collected: 0, uncollected: 0 });
    assert.deepEqual(result.rows, []);
    assert.equal(result.totalPages, 0);
    assert.equal(result.page, 1);
  }

  const failedNumber = 'R26DD20928825';
  const failedId = history.start({ section: 'order-plans', number: failedNumber });
  history.finish(failedId, 'failed', '일반 조회 실패');
  assert.equal(listByNumber('uncollected', failedNumber).rows[0].id, failedId);

  const { G2bDetailPage } = require('../src/_pages/g2b/ui/G2bDetailPage');
  const { NoticeDetailPage } = require('../src/_pages/admin/g2b/notices/ui/NoticeDetailPage');
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const params = Promise.resolve(noticeKey);
  const admin = await NoticeDetailPage({ params });
  const user = await G2bDetailPage({ section: 'notices', params, searchParams: Promise.resolve({}) });
  for (const page of [admin, user]) {
    const body = page.props.children.find((child) => child?.props?.notice);
    const html = renderToStaticMarkup(createElement(body.type, { ...body.props, renderActions: undefined }));
    assert.match(html, /R26DD20928824/);
    assert.match(html, /나라장터에서 해당 발주계획 정보를 찾을 수 없습니다\./);
    assert.doesNotMatch(html, /href="[^"]*order-plans\/R26DD20928824/);
  }

  status = 500;
  assert.equal((await collectDirectly()).status, 502);
  status = 422;
  message = '다른 오류';
  assert.equal((await collectDirectly()).status, 502);
  status = 200;
  message = '';
  await recollect();
  const updated = await repository.find(noticeKey);
  assert.equal(updated.orderPlanStatus, undefined);
  assert.equal(updated.orderPlanNumber, number);
  const collected = listByNumber('collected');
  assert.deepEqual(collected.counts, { total: 1, collected: 1, uncollected: 0 });
  assert.equal(collected.rows[0].number, number);
  const savedPlan = repository.findOrderPlan(number);
  status = 422;
  message = '발주계획정보가 존재하지 않습니다.';
  assert.deepEqual(await (await collectDirectly()).json(), { number, status: 'unprocessable-entity' });
  assert.deepEqual(repository.findOrderPlan(number), savedPlan);
});

test('공고의 호출 번호를 표시하고 저장된 발주계획 응답 번호로 연결한다', async (t) => {
  const { NoticeDetailPage } = require('../src/_pages/admin/g2b/notices/ui/NoticeDetailPage');
  const { G2bDetailPage } = require('../src/_pages/g2b/ui/G2bDetailPage');
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const noticeKey = { number: 'R26BK01824855', revision: '000' };
  const detail = {
    bidPbancNo: noticeKey.number, bidPbancOrd: noticeKey.revision, bidPbancNm: '발주계획 연결 공고',
    oderPlanUntyNo: 'P81202600BB1-00',
  };
  const responseNumber = 'R26DD20926396';
  let returnedNumber;
  let attachmentStatus = 500;
  let planCalls = 0;
  let attachmentCalls = 0;
  mockFetch(t, (path, options) => {
    if (path === '/') return session();
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [] });
    if (path.endsWith('/selectNtcPstList.do')) return success({ dlPstL: [] });
    if (path.endsWith('/selectItemAnncMngV.do')) return success({ dmItemMap: detail });
    if (path.endsWith('/selectOderPlan.do')) {
      assert.equal(JSON.parse(options.body).dlParamM.oderPlanNo, detail.oderPlanUntyNo);
      planCalls++;
      return success({ dlOderPlanM: { oderPlanNo: returnedNumber, oderPlanUntyAtchFileNo: group } });
    }
    assert.ok(path.endsWith('/selectUntyAtchFileList.do'), path);
    attachmentCalls++;
    return attachmentStatus === 500
      ? new Response(null, { status: 500 })
      : success({ dlUntyAtchFileL: [] });
  });

  const recollect = () => collectSingleNotice({ ...noticeKey, methodCode: '' }, true);
  const history = repository.collectionAttempts;
  const initialCounts = history.counts('order-plans');
  for (returnedNumber of [undefined, 'R26BK20926396']) {
    await recollect();
    assert.equal((await repository.find(noticeKey)).orderPlanNumber, undefined);
    assert.equal(repository.findOrderPlan('R26BK20926396'), null);
  }

  returnedNumber = responseNumber;
  await recollect();
  assert.equal(planCalls, 3);
  assert.equal(attachmentCalls, 1);
  const saved = await repository.find(noticeKey);
  assert.deepEqual(saved.payload.dmItemMap, detail);
  assert.equal(saved.orderPlanNumber, responseNumber);
  assert.equal(repository.findOrderPlan(responseNumber).attachments, undefined);
  assert.equal(repository.findOrderPlan(detail.oderPlanUntyNo), null);
  assert.deepEqual(history.counts('order-plans'), {
    total: initialCounts.total + 1, collected: initialCounts.collected + 1, uncollected: initialCounts.uncollected,
  });
  const failure = history.overview('order-plans').failures.find(({ number }) => number === responseNumber);
  assert.equal(failure.hasData, true);
  assert.deepEqual(history.retryTarget(failure.id), { section: 'order-plans', number: responseNumber });
  assert.deepEqual(history.orderPlanList.page(parseOrderPlanListQuery({
    field: 'number', q: detail.oderPlanUntyNo, status: 'uncollected',
  }, [])).rows, []);
  const linkedNotices = () => repository.findNoticesForOrderPlan(responseNumber).map((row) => ({ ...row }));
  assert.deepEqual(linkedNotices(), [noticeKey]);
  assert.deepEqual(repository.findNoticesForOrderPlan(detail.oderPlanUntyNo), []);
  await assert.rejects(collectOrderPlan(detail.oderPlanUntyNo, true), /발주계획의 상세 응답/);

  attachmentStatus = 200;
  detail.oderPlanUntyNo = 'R26DD20926397';
  await recollect();
  assert.ok(repository.findOrderPlan(responseNumber).attachments);
  const collected = repository.findOrderPlan(responseNumber);
  await recollect();
  assert.deepEqual(repository.findOrderPlan(responseNumber), collected);
  assert.equal(attachmentCalls, 2);

  const anotherKey = { number: 'R26BK01824857', revision: '000' };
  await repository.save({ ...(await repository.find(noticeKey)), ...anotherKey });
  detail.oderPlanUntyNo = 'P81202600BB1-00';
  await recollect();
  assert.equal(history.retryTarget(failure.id), 'conflict');
  assert.equal(history.counts('order-plans').uncollected, initialCounts.uncollected);
  const admin = await NoticeDetailPage({ params: Promise.resolve(noticeKey) });
  const user = await G2bDetailPage({
    section: 'notices', params: Promise.resolve(noticeKey), searchParams: Promise.resolve({}),
  });
  for (const [page, prefix] of [[admin, '/admin'], [user, '']]) {
    const body = page.props.children.find((child) => child?.props?.notice);
    const html = renderToStaticMarkup(createElement(body.type, { ...body.props, renderActions: undefined }));
    assert.ok(html.includes(`href="${prefix}/g2b/order-plans/${responseNumber}">${detail.oderPlanUntyNo}</a>`));
  }

  const legacyKey = { number: 'R26BK01824856', revision: '000' };
  await repository.save({
    ...saved, ...legacyKey, orderPlanNumber: undefined,
    payload: { dmItemMap: { ...detail, oderPlanUntyNo: responseNumber } },
  });
  assert.deepEqual(linkedNotices(), [noticeKey, legacyKey, anotherKey]);
  const orderPlanPage = await G2bDetailPage({
    section: 'order-plans', params: Promise.resolve({ number: responseNumber }), searchParams: Promise.resolve({}),
  });
  const orderPlanBody = orderPlanPage.props.children.find((child) => child?.props?.plan);
  assert.equal(orderPlanBody.props.noticePath(noticeKey), '/g2b/notices/R26BK01824855/000');
  assert.ok(orderPlanBody.props.notices.some(({ number }) => number === noticeKey.number));
});

test('민간공고 21~24는 원본 상세 API를 사용하고 응답을 보존한다', async (t) => {
  const key = { number: 'R26BK01827103', revision: '001' };
  const detail = { bidPbancNo: key.number, bidPbancOrd: key.revision, bidPbancNm: '외부시설물 설치공사' };
  const result = { bidPbancMap: detail, pbancOrgMap: { onbsPlacNm: '현장' }, bidPbancItemlist: [] };
  let businessCode = '21';
  mockFetch(t, (path, options) => {
    if (path === '/') return new Response('', { headers: { 'Set-Cookie': 'test-session=1; Path=/' } });
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [{ prcmBsneSeCd: businessCode }] });
    if (path.endsWith('/selectBidPbancDetl.do')) {
      const input = JSON.parse(options.body).dlSrchCndtM;
      assert.deepEqual([input.bidPbancNo, input.bidPbancOrd], [key.number, key.revision]);
      return success({ result });
    }
    if (path.endsWith('/selectBidNoceDetl.do')) return success({ result: { noceList: [] } });
    assert.ok(!path.endsWith('/selectItemAnncMngV.do') && !path.endsWith('/selectFrcpBidPbacDtlInfo.do'));
    return success({});
  });
  for (businessCode of ['21', '22', '23', '24']) {
    const lookup = businessCode === '22' ? undefined :
      { registrationType: '통050002', businessCode, rawRevision: key.revision };
    const { notice } = await collectNotice(key, '낙030001', undefined, lookup);
    assert.equal(notice.title, detail.bidPbancNm);
    assert.deepEqual(notice.payload.result, result);
    assert.equal(notice.payload.dmItemMap.prcmBsneSeCd, businessCode);
    await getG2bRepository().save(notice);
  }
  const { renderToStaticMarkup } = require('react-dom/server');
  const { createElement } = require('react');
  const { NoticeDetailPage } = require('../src/_pages/admin/g2b/notices/ui/NoticeDetailPage');
  const { G2bDetailPage } = require('../src/_pages/g2b/ui/G2bDetailPage');
  const admin = await NoticeDetailPage({ params: Promise.resolve(key) });
  const user = await G2bDetailPage({ section: 'notices', params: Promise.resolve(key), searchParams: Promise.resolve({}) });
  for (const page of [admin, user]) {
    const body = page.props.children.find((child) => child?.props?.notice);
    const html = renderToStaticMarkup(createElement(body.type, { ...body.props, renderActions: undefined }));
    let previousIndex = -1;
    for (const heading of ['공고일반', '입찰 및 계약방법', '입찰진행', '현장설명회', '투찰제한', '입찰담당정보', '파일첨부']) {
      const index = html.indexOf(heading, previousIndex + 1);
      assert.ok(index > previousIndex, heading);
      previousIndex = index;
    }
    assert.ok(html.includes('NNBB002_01'));
    const fileTable = html.match(/<table[^>]+aria-label="파일첨부"[\s\S]*?<\/table>/)?.[0];
    assert.ok(fileTable?.includes('문서구분'));
    assert.ok(fileTable.includes('조회된 내역이 없습니다.'));
    assert.ok(!fileTable.includes('등록자명'));
  }
});

test('민간공고는 원본 조건에 따라 표시하고 빈 필드와 업무별 빈 표를 보존한다', () => {
  const { getPrivateNoticeDisplay } = require('../src/entities/notice/model/private-notice-display');
  const result = {
    bidPbancMap: {
      prcmBsneSeCd: '조070004', bidMthdCd: '입180003', pnprRlsYn: 'N',
      evlcrtAmt: 123456, stdCtrtMthdCd: '계030002', cvlnPbancNmcptEtpsRlsYn: 'N',
      bidPrgrsOrd: -1, rgnLmtYn: 'Y', hsmpMngOfceTlphNo: '021234567',
    },
    bidPbancItemlist: [],
    bidLmtRgnList: [{ lgdngNm: '서울특별시' }],
    dmItemMap: { lcnsLmtYnNm: '공고서참조', intpLmtCn: '숨김 대상' },
  };
  const sections = getPrivateNoticeDisplay(result);
  const titles = sections.map(({ title }) => title);
  assert.ok(titles.includes('역경매진행'));
  for (const title of ['입찰금액', '기준금액', '지명경쟁업체', '입찰(재입찰)내역', '단지정보']) {
    assert.ok(!titles.includes(title));
  }
  const items = sections.find(({ title }) => title === '입찰상세내역');
  assert.deepEqual(items.columns, ['No', '공사명', '준공기한', '공사현장명']);
  assert.deepEqual(items.rows, []);
  assert.equal(sections.find(({ title }) => title === '공고일반').fields.find(({ label }) => label === '문서번호').value, '');
  assert.ok(!JSON.stringify(sections).includes('숨김 대상'));
});

test('민간 첨부의 저장된 코드표가 없어도 누리장터 문서구분을 표시한다', () => {
  const { getPrivateNoticeAttachmentFiles } = require('../src/entities/notice/model/private-notice-display');
  const group = '11e81849-11c5-4dfb-92a9-4d73f48e5a47';
  const notice = {
    number: 'R26BK01830344', revision: '000',
    payload: { result: {
      bidPbancMap: { untyAtchFileNo: group },
      bidBsneCndtCrtrCdMap: { bsneCndt1Val: '20000101000000' },
    } },
    documents: { attachments: { dlUntyAtchFileL: ['첨020297', '첨020417', '첨020033', '첨020109'].map((code, index) => ({
      untyAtchFileNo: group, orgnlAtchFileNm: '첨부.pdf', atchFileSqno: index + 1, atchFileKndCd: code, scrnIndtYn: 'Y',
    })) } },
  };
  assert.deepEqual(getPrivateNoticeAttachmentFiles(notice).map((file) => file.documentType),
    ['공고서(원본)', '공고서(변환본)', '규격서', '기타문서']);
  notice.privateCodeNames = { 첨02NN005: { 첨020109: '기타문서' }, '첨02NN005:supplement': { 첨020109: '' } };
  assert.equal(getPrivateNoticeAttachmentFiles(notice)[3].documentType, '기타문서');
});

test('민간 변경공고는 이전 차수의 공지 본문을 읽고 현재 차수로 표시한다', async (t) => {
  const { fetchPrivateNoticePosts } = require('../src/features/collect-g2b/api/private-notice');
  const { getPrivateNoticeDisplay } = require('../src/entities/notice/model/private-notice-display');
  const key = { number: 'R26BK01827103', revision: '001' };
  const row = { bbsNo: 'R23AB00000108', pstNo: '123', odn3ColCn: 'A', inptDt: '2026/11/13', pstNm: '변경공고사유' };
  mockFetch(t, (path, options) => {
    if (path.endsWith('/selectBidNoceDetl.do')) {
      assert.equal(JSON.parse(options.body).dlSrchCndtM.odn3ColCn, 'A');
      return success({ result: { noceList: [row] } });
    }
    assert.ok(path.endsWith('/selectBidNoceBulkPstCn.do'));
    assert.equal(JSON.parse(options.body).dlPstM.bidPbancOrd, '000');
    return success({ result: { noceMap: { odn3ColCn: 'A', bulkPstCn: '변경 내용' } } });
  });
  const posts = await fetchPrivateNoticePosts(key, '공400002', fetch);
  const detail = { bidPbancNo: key.number, bidPbancOrd: key.revision };
  const [section] = getPrivateNoticeDisplay({ bidPbancMap: detail }, posts);
  assert.equal(section.title, '공지사항(변경,취소공고사유 등)');
  assert.equal(section.fields[0].details.find(({ label }) => label === '입찰공고차수').value, '001');
  assert.equal(section.fields[0].details.find(({ label }) => label === '내용').value, '변경 내용');
  assert.equal(await fetchPrivateNoticePosts({ ...key, revision: '000' }, '공400002', fetch), undefined);
});

test('민간공고 기준금액은 개찰 상태 전까지 비공개 값을 숨긴다', () => {
  const { getPrivateNoticeDisplay } = require('../src/entities/notice/model/private-notice-display');
  const detail = { pnprRlsYn: 'N', evlcrtAmt: 123456, bidPbancPgstCd: '진010008' };
  const sections = () => getPrivateNoticeDisplay({ bidPbancMap: detail });
  const field = (title, label) => sections().find((s) => s.title === title).fields.find((f) => f.label === label).value;
  assert.equal(field('공고일반', '게시일시'), '공고게시이전입니다.');
  assert.equal(field('기준금액', '기준금액'), '원');
  detail.bidPbancPgstCd = '입160004';
  assert.equal(field('기준금액', '기준금액'), '123,456 원');
});

test('기타 공고는 업무진행을 한 번 조회하고 기타 상세와 공개 첨부를 수집한다', async (t) => {
  const key = { number: 'R26BK01792130', revision: '000' };
  const detail = {
    bidPbancUntyNo: key.number, bidPbancUntyOrd: key.revision,
    untyBidPbancNo: 'R26BM01014144', untyBidPbancOrd: '000',
    prcmBsneSeCd: '09', bidPbancNm: '기타 공고', untyAtchFileNo: group,
  };
  const calls = [];
  mockFetch(t, (path, options) => {
    if (path === '/') return session();
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
      if (path === '/') return session();
      if (path.endsWith('/srchWorkPrgs.do'))
        return success({ dlWorkPrgsL: [{ prcmBsneSeCd: '09' }] });
      assert.ok(path.endsWith('/selectUntyBidPbancDtlInfo.do'));
      return success({ dlUntyBidPbancM: {
        bidPbancUntyNo: key.number, bidPbancUntyOrd: key.revision,
        prcmBsneSeCd: '09', bidPbancNm: '기타 공고', ...override,
      } });
    });
    assert.equal((await submitNotice(request())).status, 'retry_wait');
    assert.equal(fetchMock.mock.callCount(), 4);
    fetchMock.mock.restore();
  }
  const fetchMock = mockFetch(t, (path) => {
    if (path === '/') return session();
    assert.ok(path.endsWith('/srchWorkPrgs.do'));
    return maintenancePage();
  });
  assert.equal((await submitNotice(request())).status, 'pending');
  assert.equal(fetchMock.mock.callCount(), 3);
  assert.equal(await repository.find(key), null);
});

test('기타 첨부 목록 조회 실패 시 같은 그룹에 대해서만 기존 파일을 보존한다', async (t) => {
  const key = { number: 'R26BK01792132', revision: '000' };
  let currentGroup = group;
  let attachmentsAvailable = true;
  const attachments = { ErrorCode: 0, dlUntyAtchFileL: [] };
  mockFetch(t, (path) => {
    if (path === '/') return session();
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
  const collect = () => submitNotice(new Request('http://localhost/api/notices', {
    method: 'POST', body: JSON.stringify({ ...key, methodCode: '' }),
  }));
  assert.equal((await collect()).status, 'succeeded');
  attachmentsAvailable = false;
  assert.equal((await collect()).status, 'retry_wait');
  assert.deepEqual((await repository.find(key)).documents.attachments, attachments);
  currentGroup = '00000000-0000-0000-0000-000000000002';
  assert.equal((await collect()).status, 'retry_wait');
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
  assert.deepEqual(history.retryTarget(latest, failures[0].startedAt), target);
  assert.equal(history.retryTarget(latest, '2020-01-01T00:00:00.000Z'), 'conflict');
  repository.saveContract({ number: target.number, revision: target.revision, collectedAt });
  assert.equal(history.overview('contracts').failures[0].hasData, true);
  history.finish(history.start(target), 'succeeded');
  assert.equal(history.overview('contracts').failures.length, 0);
});

test('수집 폼에서 기존 번호 형식 밖의 공고를 제출한다', async (t) => {
  const { CollectG2bForm } = require('../src/features/collect-g2b/ui/CollectG2bForm');
  const errors = [];
  t.mock.method(require('react'), 'useRef', (current) => ({ current }));
  t.mock.method(require('react'), 'useEffect', () => {});
  t.mock.method(require('react'), 'useState', (initial) => [initial, (value) => {
    if (initial === '') errors.push(value);
  }]);
  const fields = new FormData();
  fields.set('number', ' E012608144 ');
  fields.set('revision', '000');
  fields.set('methodCode', '');
  t.mock.method(globalThis, 'FormData', function () { return fields; });
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const collected = [];
  const form = CollectG2bForm({
    section: 'notices',
    onCollected: async (key) => { collected.push(key); },
    onFailure: () => assert.fail('수집 실패 처리 실행'),
  }).props.children[0];
  const submit = () => form.props.onSubmit({ preventDefault() {}, currentTarget: {} });

  await submit();
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(fetch.mock.calls[0].arguments[1].body), {
    number: 'E012608144', revision: '000', methodCode: '',
  });
  assert.deepEqual(collected, [{ number: 'E012608144', revision: '000' }]);
});

test('여섯 업무의 미저장 실패를 기록하고 이력의 입력으로 재수집한다', async (t) => {
  const { collectContract, collectOpeningResult } = require('../src/features/collect-g2b/server');
  const { POST: retry } = require('../app/api/g2b/collection-attempts/[id]/retry/route');
  const orderPlanNumber = 'R26DD00000010';
  const priorSpecNumber = 'R26BD00000010';
  const contractRequestNumber = 'RETRY-1';
  const contractNumber = 'R26TA00000010';
  const notice = { number: 'R26BK00000010', revision: '000', methodCode: 'METHOD' };
  const opening = { number: notice.number, revision: '001', openingRevision: '002' };
  const queries = [{ ...opening, classification: '1', businessCode: '업130020' }];
  let unavailable = true;
  const calls = mockFetch(t, (path, options) => {
    if (unavailable) return new Response(null, { status: 500 });
    if (path === '/') return session();
    const input = JSON.parse(options.body);
    if (path.endsWith('/selectOderPlan.do')) return success({ dlOderPlanM: { oderPlanNo: orderPlanNumber } });
    if (path.endsWith('/selectBfSpec.do')) return success({ dlBfSpecM: { bfSpecRegNo: priorSpecNumber } });
    if (path.endsWith('/srchDmndSttusSql.do')) return success({ dlTotalSrchL: [{ bizNo: contractRequestNumber, bizOrd: 0 }] });
    if (path.endsWith('/srchDmndSttusItemSql.do')) return success({ dlTotalSrchItemL: [] });
    if (path.endsWith('/srchCtrtDtl.do')) return success({
      dlCtrtMngLstM: { ctrtNo: contractNumber, ctrtChgOrd: 0 },
      dlCtrtEtpsLstL: [], dlCtrtEtpsSvsLstL: [], dlCtrtItemLstL: [],
    });
    if (path.endsWith('/selectItemAnncMngV.do')) return noticeDetail({ bidPbancNo: notice.number });
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [] });
    if (path.endsWith('/selectOnbsRsltFbid.do')) {
      return success({ result: { bidPrgrs: { ...input.dlSrchOnbsRsltBidInM, prcsRsn: '새 결과' } } });
    }
    if (path.endsWith('/selectRsvePrceInfo.do')) return success({ pbancInfo: input.dlSrchPbancInfoInM, rsvePrceList: [] });
    if (path.endsWith('/selectNtcPstList.do')) return success({ dlPstL: [] });
    assert.fail(path);
  });
  const cases = [
    ['order-plans', orderPlanNumber, () => collectOrderPlan(orderPlanNumber, true)],
    ['prior-specs', priorSpecNumber, () => collectPriorSpec(priorSpecNumber, true)],
    ['contract-requests', contractRequestNumber, () => collectContractRequest({ number: contractRequestNumber, revision: '000' }, true)],
    ['contracts', contractNumber, () => collectContract({ number: contractNumber, revision: '00' }, true)],
    ['notices', notice.number, () => collectSingleNotice(notice)],
    ['opening-results', opening.number, () => collectOpeningResult(opening, queries, true)],
  ];
  const request = new Request('http://localhost', { method: 'POST' });
  for (const [section, number, collect] of cases) {
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
    if (section === 'notices') assert.equal((await acceptedJob(response)).status, 'succeeded');
    else assert.equal(response.status, 204, response.status === 204 ? section : await response.text());
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

function relatedNoticeRequest(number, revision = '000') {
  return postNotice(new Request('http://localhost/api/notices', {
    method: 'POST', body: JSON.stringify({ number, revision, methodCode: '' }),
  }));
}

function mockRelatedNotices(t, onDetail) {
  return mockFetch(t, (path, options) => {
    if (path === '/') return session();
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [] });
    if (path.endsWith('/selectNtcPstList.do')) return success({ dlPstL: [] });
    assert.ok(path.endsWith('/selectItemAnncMngV.do'), path);
    const { dmItemMap } = JSON.parse(options.body);
    return onDetail(dmItemMap, (related) => noticeDetail({ ...dmItemMap, relaPbancNo: related }));
  });
}

test('발주계획과 입찰공고 어느 쪽에서 시작해도 계획의 미수집 공고를 순환 없이 수집한다', { timeout: 5000 }, async (t) => {
  const { POST: postOrderPlan } = require('../app/api/order-plans/[number]/route');
  for (const [index, startFromPlan] of [true, false].entries()) {
    const planNumber = `R26DD0000063${index}`;
    const a = `R26BK0000063${index}`, b = `R26BK0000064${index}`, c = `R26BK0000065${index}`;
    const key = { number: a, revision: '000' };
    if (startFromPlan) await repository.save({
      ...key, title: '기존 공고', collectedAt,
      payload: { dmItemMap: { bidPbancNo: a, bidPbancOrd: '000', oderPlanNo: planNumber } },
    });
    const calls = [];
    const mockRequest = mockFetch(t, (path, options) => {
      if (path === '/') return session();
      if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [] });
      if (path.endsWith('/selectNtcPstList.do')) return success({ dlPstL: [] });
      if (path.endsWith('/selectOderPlan.do')) {
        calls.push(planNumber);
        return success({ dlOderPlanM: {
          oderPlanNo: planNumber, bidPbancList: [a, b, b].map((number) => ({ bidPbancNo: number, bidPbancOrd: '000' })),
        } });
      }
      assert.ok(path.endsWith('/selectItemAnncMngV.do'), path);
      const { bidPbancNo, bidPbancOrd } = JSON.parse(options.body).dmItemMap;
      calls.push(bidPbancNo);
      return noticeDetail({
        bidPbancNo, bidPbancOrd, oderPlanNo: planNumber,
        relaPbancNo: bidPbancNo === b ? `${c}-000,${a}-000` : undefined,
      });
    });
    try {
      const response = startFromPlan
        ? await postOrderPlan(new Request('http://localhost', { method: 'POST' }), {
            params: Promise.resolve({ number: planNumber }),
          })
        : await relatedNoticeRequest(a);
      assert.equal(response.status, startFromPlan ? 200 : 202);
      await drainNoticeJobs();
      assert.deepEqual(calls, [...(startFromPlan ? [] : [a]), planNumber, b, c]);
      assert.ok(await repository.find({ number: c, revision: '000' }));
    } finally {
      mockRequest.mock.restore();
    }
  }
});

test('관련공고 수집은 정상 저장 건을 거쳐 미수집 차수까지 탐색하고 내부 링크를 표시한다', async (t) => {
  const a = 'R26BK00000601', b = 'R26BK00000602', c = 'R26BK00000603';
  const bKey = { number: b, revision: '000' };
  await repository.save({ ...bKey, title: '저장 공고', collectedAt, payload: { dmItemMap: {
    bidPbancNo: b, bidPbancOrd: 0, relaPbancNo: `${c}-000,${c}-001,${a}-000`,
  } } });
  const start = t.mock.method(repository.collectionAttempts, 'start');
  const calls = [];
  mockRelatedNotices(t, ({ bidPbancNo, bidPbancOrd, scsbdMthdCd }, detail) => {
    assert.equal(scsbdMthdCd, '');
    calls.push(`${bidPbancNo}-${bidPbancOrd}`);
    return detail(bidPbancNo === a ? `${a}-000,${b}-000,${b}-000,${c}-000` : undefined);
  });
  assert.equal((await acceptedJob(await relatedNoticeRequest(a))).status, 'succeeded');
  assert.deepEqual(calls, [`${a}-000`, `${c}-000`, `${c}-001`]);
  assert.ok(start.mock.calls.every(({ arguments: [target] }) => target.number !== b));
  const { renderToStaticMarkup } = require('react-dom/server');
  const { createElement } = require('react');
  const { NoticeDetailPage } = require('../src/_pages/admin/g2b/notices/ui/NoticeDetailPage');
  const { G2bDetailPage } = require('../src/_pages/g2b/ui/G2bDetailPage');
  const params = Promise.resolve({ number: a, revision: '000' });
  const admin = await NoticeDetailPage({ params });
  const user = await G2bDetailPage({
    section: 'notices', params, searchParams: Promise.resolve({}),
  });
  for (const [page, prefix] of [[admin, '/admin'], [user, '']]) {
    const body = page.props.children.find((child) => child?.props?.notice);
    const html = renderToStaticMarkup(createElement(body.type, { ...body.props, renderActions: undefined }));
    assert.ok(html.includes(`href="${prefix}/g2b/notices/${c}/000"`));
  }
});

test('모의공고는 사용자 목록과 상세 및 관련공고 내부 링크에서 제외된다', async () => {
  const { G2bDetailPage } = require('../src/_pages/g2b/ui/G2bDetailPage');
  const { NoticeDetailPage } = require('../src/_pages/admin/g2b/notices/ui/NoticeDetailPage');
  const { loadCollectionList } = require('../src/server/g2b/repository/load-collection-list');
  const simulated = { number: 'R26BK00000991', revision: '000' };
  const regular = { number: 'T26BK00000992', revision: '000' };
  for (const [key, kind] of [[simulated, '모의공고&#40;등록공고&#41;'], [regular, '일반공고']]) {
    await repository.save({ ...key, collectedAt, title: key.number, payload: { dmItemMap: {
      bidPbancNo: key.number, bidPbancOrd: key.revision, pbancKndNm: kind,
    } } });
  }
  const query = { field: 'number', q: simulated.number };
  assert.equal(loadCollectionList('notices', query).result.rows[0].number, simulated.number);
  assert.deepEqual(loadCollectionList('notices', query, 'collected', { excludeMockNotices: true }).result.rows, []);
  const userDetail = (key) => G2bDetailPage({
    section: 'notices', params: Promise.resolve(key), searchParams: Promise.resolve({}),
  });
  await assert.rejects(userDetail(simulated), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  const admin = await NoticeDetailPage({ params: Promise.resolve(simulated) });
  assert.equal(admin.props.children.find((child) => child?.props?.notice).props.notice.number, simulated.number);
  const user = await userDetail(regular);
  const { links, notice } = user.props.children.find((child) => child?.props?.notice).props;
  assert.equal(notice.number, regular.number);
  assert.equal(links.noticePath(simulated), undefined);
  assert.equal(links.noticePath(regular), '/g2b/notices/T26BK00000992/000');
});

test('관련공고 수집은 손상된 상세를 복구하고 실패한 행을 보존하며 점검 시 중단한다', async (t) => {
  const [a, badJson, missing, mismatch, failed, next, deferred, skipped, lookupError, retryChild, failedShape] =
    Array.from({ length: 11 }, (_, index) => `R26BK${String(610 + index).padStart(8, '0')}`);
  const db = new DatabaseSync(join(tempDir, '.data', 'notices.sqlite'));
  t.after(() => db.close());
  const insert = db.prepare('INSERT INTO notices VALUES (?, ?, ?, ?)');
  const revision = '000';
  const wrongDetail = JSON.stringify({ payload: { dmItemMap: { bidPbancNo: a, bidPbancOrd: revision } } });
  for (const [number, data] of [
    [badJson, '{'], [missing, '{}'], [mismatch, wrongDetail], [failed, '{'], [failedShape, 'null'],
  ]) {
    insert.run(number, revision, '2099-01-01T00:00:00.000Z', data);
  }
  const read = repository.findUsableNotice;
  t.mock.method(repository, 'findUsableNotice', (key) => {
    if (key.number === lookupError) throw new Error('SQLite 조회 테스트 오류');
    return read(key);
  });
  const calls = [];
  let retrying = false;
  mockRelatedNotices(t, ({ bidPbancNo }, detail) => {
    calls.push(bidPbancNo);
    if (bidPbancNo === failed) return retrying ? detail(`${retryChild}-000`) : new Response('', { status: 500 });
    if (bidPbancNo === failedShape) return new Response('', { status: 500 });
    if (bidPbancNo === deferred && !retrying) return maintenancePage();
    if (bidPbancNo === a) return detail([badJson, missing, mismatch, failed, failedShape, lookupError, next, deferred, skipped]
      .map((number) => `${number}-000`).join(','));
    return detail();
  });
  assert.equal((await acceptedJob(await relatedNoticeRequest(a))).status, 'succeeded');
  assert.deepEqual(calls, [a, badJson, missing, mismatch, failed, failedShape, next, deferred]);
  for (const number of [badJson, missing, mismatch, next]) {
    assert.equal((await repository.find({ number, revision })).payload.dmItemMap.bidPbancNo, number);
  }
  assert.equal(db.prepare('SELECT data FROM notices WHERE number = ?').get(failed).data, '{');
  assert.equal(db.prepare('SELECT data FROM notices WHERE number = ?').get(failedShape).data, 'null');
  assert.equal(await repository.find({ number: skipped, revision }), null);
  const failures = repository.collectionAttempts.overview('notices').failures;
  const failedAttempt = failures.find(({ number }) => number === failed);
  assert.equal(failedAttempt.status, 'failed');
  assert.doesNotThrow(() => repository.collectionAttempts.noticeList.regions());
  assert.doesNotThrow(() => repository.collectionAttempts.noticeList.businesses());
  const { noticeList } = repository.collectionAttempts;
  assert.doesNotThrow(() => noticeList.page(parseNoticeListQuery({}, noticeList.regions(), noticeList.businesses())));
  assert.equal(failures.find(({ number }) => number === deferred).status, 'deferred');
  assert.match(failures.find(({ number }) => number === lookupError).diagnostics, /SQLite 관련공고 조회/);
  const { NoticeDetailPage } = require('../src/_pages/admin/g2b/notices/ui/NoticeDetailPage');
  const page = await NoticeDetailPage({ params: Promise.resolve({ number: a, revision }) });
  const body = page.props.children.find((child) => child?.props?.notice);
  assert.equal(body.props.links.noticePath({ number: failed, revision }), undefined);
  const { POST: retry } = require('../app/api/g2b/collection-attempts/[id]/retry/route');
  retrying = true;
  queue.clearMaintenance(queue.maintenanceVersion());
  assert.equal((await acceptedJob(await retry(new Request('http://localhost', { method: 'POST' }), {
    params: Promise.resolve({ id: String(failedAttempt.id) }),
  }))).status, 'succeeded');
  assert.ok(calls.lastIndexOf(failed) < calls.indexOf(retryChild));
  assert.ok(calls.includes(skipped));
  assert.ok(await repository.find({ number: retryChild, revision }));
});

test('서로 참조하는 공고의 동시 접수는 큐에서 순차 실행된다', { timeout: 5000 }, async (t) => {
  const a = 'R26BK00000621', b = 'R26BK00000622';
  const calls = [];
  mockRelatedNotices(t, async ({ bidPbancNo }, detail) => {
    calls.push(bidPbancNo);
    return detail(`${bidPbancNo === a ? b : a}-000`);
  });
  const responses = await Promise.all([relatedNoticeRequest(a), relatedNoticeRequest(b)]);
  assert.deepEqual(responses.map(({ status }) => status), [202, 202]);
  assert.deepEqual(calls, []);
  await drainNoticeJobs();
  assert.deepEqual(calls, [a, b]);
});

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
  const job = await submitNotice(noticeRequest());
  assert.equal(job.status, 'pending');
  assert.ok(queue.maintenanceVersion());
  assert.deepEqual(await repository.find(key), previous);
  assert.equal(calls.mock.calls.filter(({ arguments: [url] }) => new URL(url).pathname.endsWith('/selectPst.do')).length, 1);
});

test('일반 API 오류는 재시도 대기로 처리하고 정상 공고는 저장한다', async (t) => {
  const calls = mockFetch(t, () => new Response(null, { status: 503 }));
  for (const respond of [
    () => new Response(null, { status: 503 }),
    () => new Response('Forbidden', { status: 403 }),
    () => { throw new DOMException('timeout', 'TimeoutError'); },
  ]) {
    calls.mock.mockImplementation(respond);
    assert.equal((await submitNotice(noticeRequest())).status, 'retry_wait');
  }
  calls.mock.mockImplementation(async (url) => {
    const path = new URL(url).pathname;
    if (path === '/') return session();
    if (path.endsWith('/selectBidPbacScrollTypeList.do')) return success({ result: [] });
    if (path.endsWith('/selectItemAnncMngV.do')) return noticeDetail();
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [] });
    if (path.endsWith('/selectNtcPstList.do')) return success({ dlPstL: [] });
    assert.fail(path);
  });
  assert.equal((await submitNotice(noticeRequest())).status, 'succeeded');
  const saved = await repository.find(key);
  assert.equal(saved.title, '새 공고');
  assert.notEqual(saved.collectedAt, collectedAt);
});

function mockNoticeContracts(t, rows, respondToContract) {
  const requested = [];
  mockFetch(t, (path, options) => {
    if (path === '/') return session();
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

  assert.equal((await submitNotice(noticeRequest())).status, 'succeeded');
  assert.deepEqual((await repository.find(key)).contracts, [contract]);
  assert.deepEqual(repository.findContract(contract)?.detail, {
    ctrtNo: contract.number, ctrtChgOrd: contract.revision,
  });
  assert.equal((await submitNotice(noticeRequest())).status, 'succeeded');
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
    if (path === '/') return session();
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
    assert.equal((await submitNotice(noticeRequest())).status, 'succeeded');
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

  assert.equal((await submitNotice(noticeRequest())).status, 'retry_wait');
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

  const job = await submitNotice(noticeRequest());
  assert.equal(job.status, 'pending');
  assert.ok(queue.maintenanceVersion());
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


test("계약요청 품목이 10건을 초과해도 한 번만 조회하고 전체 저장한다", async (t) => {
  const contractKey = { number: "REQ-ITEMS-18", revision: "000" };
  const items = Array.from({ length: 18 }, (_, index) => ({
    ctrtDmndRcptNo: contractKey.number,
    ctrtDmndRcptOrd: "0",
    index,
  }));

  let itemCalls = 0;

  mockFetch(t, (path) => {
    if (path.endsWith("/srchDmndSttusSql.do")) {
      return success({
        dlTotalSrchL: [
          {
            bizNo: contractKey.number,
            bizOrd: 0,
          },
        ],
      });
    }

    if (path.endsWith("/srchDmndSttusItemSql.do")) {
      itemCalls++;
      return success({ dlTotalSrchItemL: items });
    }

    assert.fail(path);
  });

  await collectContractRequest(contractKey, true);

  assert.equal(itemCalls, 1);
  assert.deepEqual(repository.findContractRequest(contractKey)?.items, items);
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

test('유찰·입찰취소·재입찰과 구형 유찰의 일반·강제 수집은 예정가격을 조회하지 않는다', async (t) => {
  const { collectOpeningResult } = require('../src/features/collect-g2b/api/opening-results');
  let detailVersion = '최초 수집';
  const priceCalls = [];
  mockFetch(t, (path, options) => {
    if (path === '/') return session();
    const input = JSON.parse(options.body);
    if (path.endsWith('/selectRsvePrceInfo.do')) {
      priceCalls.push(input.dlSrchPbancInfoInM.bidPrgrsOrd);
      return success({ pbancInfo: input.dlSrchPbancInfoInM, rsvePrceList: [] });
    }
    if (path.endsWith('/selectOnbsRsltRbid.do')) {
      return success({ result: {
        bidPrgrs: { ...input.dlSrchOnbsRsltBidInM, prcsRsn: detailVersion },
        reBidInfo: [],
      } });
    }
    if (path.endsWith('/selectOnbsRsltFbid.do')) {
      return success({ result: { bidPrgrs: { ...input.dlSrchOnbsRsltBidInM, prcsRsn: detailVersion } } });
    }
    assert.ok(path.endsWith('/selectNtcPstList.do'), path);
    return success({ dlPstL: [] });
  });
  const cases = [
    ['001', '유찰'], ['002', '입찰취소'], ['003', '재입찰'], ['004', undefined],
  ];
  for (const force of [false, true]) {
    for (const [openingRevision, status] of cases) {
      const openingKey = { number: 'R26BK90000125', revision: '000', openingRevision };
      const query = { ...openingKey, classification: '1', businessCode: '01', ...(status ? { status } : {}) };
      await collectOpeningResult(openingKey, [query], force);
      const saved = repository.findOpeningResult(openingKey);
      const { detail } = saved.results[0];
      assert.equal((status === '재입찰' ? detail.bidPrgrs : detail).prcsRsn, detailVersion);
      assert.equal(saved.notice, null);
    }
    detailVersion = '강제 재수집';
  }
  assert.deepEqual(priceCalls, []);
});

test('개찰완료 분류만 예정가격을 요청하며 강제 재수집 오류는 기존 가격을 보존하고 실패로 기록한다', async (t) => {
  const { collectOpeningResult } = require('../src/features/collect-g2b/api/opening-results');
  const openingKey = { number: 'R26BK90000124', revision: '000', openingRevision: '001' };
  const queries = [
    { ...openingKey, classification: '1', businessCode: '01', status: '유찰' },
    { ...openingKey, classification: '2', businessCode: '01', status: '개찰완료' },
    { ...openingKey, classification: '3', businessCode: '01', status: '개찰완료' },
  ];
  const priceCalls = [];
  let failPrice = false;
  mockFetch(t, (path, options) => {
    if (path === '/') return session();
    const input = JSON.parse(options.body);
    if (path.endsWith('/selectRsvePrceInfo.do')) {
      const pbancInfo = input.dlSrchPbancInfoInM;
      priceCalls.push(pbancInfo.bidClsfNo);
      return failPrice ? new Response(null, { status: 500 }) : success({ pbancInfo, rsvePrceList: [] });
    }
    if (path.endsWith('/selectOnbsRsltFbid.do')) {
      return success({ result: { bidPrgrs: input.dlSrchOnbsRsltBidInM } });
    }
    if (path.endsWith('/selectOnbsRsltSbidGods.do')) {
      return success({ result: { bidInfo: input.dlSrchOnbsRsltBidInM, etcData: {}, successBidInfo: [] } });
    }
    assert.ok(path.endsWith('/selectNtcPstList.do'), path);
    return success({ dlPstL: [] });
  });

  await collectOpeningResult(openingKey, queries);
  await collectOpeningResult(openingKey, queries);
  assert.deepEqual(priceCalls, ['2']);
  const price = repository.findOpeningResult(openingKey).price;
  assert.equal(price.pbancInfo.bidClsfNo, '2');

  failPrice = true;
  await assert.rejects(collectOpeningResult(openingKey, queries, true), AggregateError);
  assert.deepEqual(priceCalls, ['2', '2']);
  assert.deepEqual(repository.findOpeningResult(openingKey).price, price);
  const failure = repository.collectionAttempts.overview('opening-results').failures.find(
    ({ number, revision, openingRevision }) =>
      number === openingKey.number && revision === openingKey.revision && openingRevision === openingKey.openingRevision,
  );
  const [diagnostic] = JSON.parse(failure.diagnostics).errors;
  assert.equal(failure.status, 'failed');
  assert.match(diagnostic.message, /예정가격/);
  assert.equal(diagnostic.cause.response.status, 500);
  assert.match(diagnostic.cause.stack, /request\.ts:\d+:\d+/);
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
  const diagnostics = JSON.parse(failure.diagnostics);
  assert.equal(diagnostics.errors.length, 1);
  assert.equal(diagnostics.errors[0].details['개찰 분류'], '2');
  assert.equal(diagnostics.errors[0].cause.response.status, 500);
  assert.match(diagnostics.errors[0].cause.stack, /request\.ts:\d+:\d+/);
});

test('적격심사는 차수·분류별로 보충하고 재수집 오류 또는 점검에서 기존 자료를 보존한다', async (t) => {
  const { collectOpeningResult } = require('../src/features/collect-g2b/api/opening-results');
  const number = 'R26BK90000123';
  const openingKey = { number, revision: '000', openingRevision: '001' };
  const nextKey = { ...openingKey, openingRevision: '002' };
  const makeQueries = (key) => ['1', '2', '3'].map((classification) => ({
    ...key, classification, businessCode: '01', status: '개찰완료', endpoint: 'selectOnbsRsltSbidGods',
  }));
  const detail = (classification, title) => ({
    bidInfo: { bidPbancNo: number, bidPbancOrd: '000', bidPbancNm: title, scsbdMthdCd: classification === '3' ? '낙030002' : '낙030001' },
    etcData: {}, successBidInfo: [],
  });
  const queries = makeQueries(openingKey);
  for (const key of [openingKey, nextKey]) repository.saveOpeningResult({
    ...key, collectedAt, notice: null, price: null,
    results: makeQueries(key).map((query) => ({ query, detail: detail(query.classification, '기존 공고') })),
  });
  let failure = '';
  const reviews = [];
  mockFetch(t, (path, options) => {
    if (path === '/') return session();
    const input = JSON.parse(options.body);
    if (path.endsWith('/selectOnbsRsltSbidGods.do')) {
      return success({ result: detail(input.dlSrchOnbsRsltBidInM.bidClsfNo, '새 공고') });
    }
    if (path.endsWith('/selectBidInfo.do')) return success({ bidPbanc: input.dlParamM });
    if (path.endsWith('/selectQlemRsltJdgmntList.do')) {
      const id = input.dlParamM;
      reviews.push([id.bidPrgrsOrd, id.bidClsfNo]);
      if (id.bidClsfNo === '1' && failure === 'maintenance') return maintenancePage();
      if (id.bidClsfNo === '1' && failure === 'error') return new Response(null, { status: 500 });
      return success({ dlSelectYnM: { selectYn: 'Y' }, qlemRsltJdgmntList: id.bidClsfNo === '2'
        ? [] : [{ ...id, grpNm: `업체-${id.bidPrgrsOrd}-${id.bidClsfNo}` }] });
    }
    if (path.endsWith('/selectRsvePrceInfo.do')) return success({
      pbancInfo: { bidPbancNo: number, bidPbancOrd: '000', bidClsfNo: '1', bidPrgrsOrd: '001' }, rsvePrceList: [],
    });
    return success({ dlPstL: [] });
  });
  await collectOpeningResult(openingKey, queries);
  await collectOpeningResult(openingKey, queries);
  await collectOpeningResult(nextKey, makeQueries(nextKey));
  assert.deepEqual(reviews.sort(), [['001', '1'], ['001', '2'], ['002', '1'], ['002', '2']]);
  const entries = (key) => repository.findOpeningResult(key).results;
  const first = entries(openingKey)[0].qualificationReview;
  assert.equal(first.judgmentResponse.qlemRsltJdgmntList[0].grpNm, '업체-001-1');
  assert.equal(entries(nextKey)[0].qualificationReview.judgmentResponse.qlemRsltJdgmntList[0].grpNm, '업체-002-1');
  assert.equal(entries(openingKey)[1].qualificationReview, null);
  assert.equal(entries(openingKey)[2].qualificationReview, undefined);

  failure = 'error';
  await assert.rejects(collectOpeningResult(openingKey, queries, true), (error) =>
    error.errors.length === 1 && error.errors[0].message === '적격심사결과 조회 실패');
  assert.deepEqual(entries(openingKey)[0].qualificationReview, first);
  assert.equal(entries(openingKey)[0].detail.bidInfo.bidPbancNm, '새 공고');
  assert.equal(reviews.filter(([ord, clsf]) => ord === '001' && clsf === '2').length, 2);

  const beforeMaintenance = repository.findOpeningResult(openingKey);
  failure = 'maintenance';
  await assert.rejects(collectOpeningResult(openingKey, queries, true), (error) => Boolean(findMaintenance(error)));
  assert.deepEqual(repository.findOpeningResult(openingKey), beforeMaintenance);
});

test('연기공고의 HTTP 200 점검 HTML은 다른 공지 오류보다 우선하며 개찰차수를 보존한다', async (t) => {
  const noticeKey = { number: 'R26BK00000002', revision: '000' };
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
      if (bidPbancNo === 'R26BK00000699') {
        return success({ dmItemMap: { bidPbancNo, bidPbancOrd, bidPbancNm: '관련 공고' } });
      }
      fetchedNotices.push({ bidPbancNo, scsbdMthdCd });
      await new Promise(setImmediate);
      return success({
        dmItemMap: {
          bidPbancNo, bidPbancOrd, bidPbancNm: '새 공고', prcmBsneSeCd: '03', relaPbancNo: 'R26BK00000699-000',
        },
        dlBidBasePgstL: bidPbancNo === 'R26BK00000023' ? [] : ['001', '002'].map((bidPrgrsOrd) => ({
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
    if (detail.bidPbancNo === 'R26BK00000024' && detail.bidPrgrsOrd === '002') return maintenancePage();
    if (failSecond && detail.bidPrgrsOrd === '002') return new Response(null, { status: 500 });
    return success({ result: { bidPrgrs: detail } });
  });
  const requestOpening = (number, body) => postOpeningResults(
    new Request('http://localhost', { method: 'POST', body }),
    { params: Promise.resolve({ number, revision: '000' }) },
  );
  const body = JSON.stringify({ methodCode: 'METHOD' });
  const responses = await Promise.all([requestOpening('R26BK00000021', body), requestOpening('R26BK00000021', body)]);
  const ids = await Promise.all(responses.map(async (response) => {
    assert.equal(response.status, 202);
    return (await response.json()).jobId;
  }));
  assert.equal(ids[0], ids[1]);
  await drainNoticeJobs();
  for (const id of ids) {
    const job = queue.get(id);
    assert.equal(job.status, 'retry_wait');
    const result = job.result;
    assert.equal(result.noticeSaved, true);
    assert.deepEqual(result.targetRevisions, ['001', '002']);
    assert.deepEqual(result.succeededRevisions, ['001']);
    assert.deepEqual(result.failedRevisions, ['002']);
  }
  assert.deepEqual(fetchedNotices, [{ bidPbancNo: 'R26BK00000021', scsbdMthdCd: 'METHOD' }]);
  assert.deepEqual(fetchedOpenings.sort(), ['001', '002']);
  assert.ok(await repository.find({ number: 'R26BK00000021', revision: '000' }));

  failSecond = false;
  assert.equal((await requestOpening('R26BK00000021')).status, 200);
  assert.equal(fetchedNotices.length, 1);
  assert.deepEqual(fetchedOpenings.slice(2).sort(), ['001', '002']);
  assert.equal((await acceptedJob(await requestOpening('R26BK00000022'))).status, 'succeeded');

  const absent = await acceptedJob(await requestOpening('R26BK00000023'));
  assert.equal(absent.status, 'retry_wait');
  assert.equal(absent.result.noticeSaved, true);
  const deferred = await acceptedJob(await requestOpening('R26BK00000024'));
  assert.equal(deferred.status, 'pending');
  const result = deferred.result;
  assert.equal(result.noticeSaved, false);
  assert.deepEqual(result.succeededRevisions, ['001']);
  assert.deepEqual(result.failedRevisions, ['002']);
  assert.equal(await repository.find({ number: 'R26BK00000024', revision: '000' }), null);
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
      CREATE TABLE g2b_collection_attempts (
        id INTEGER PRIMARY KEY, section TEXT, number TEXT, revision TEXT, opening_revision TEXT,
        input TEXT, started_at TEXT, finished_at TEXT, status TEXT DEFAULT 'pending', error TEXT
      );
      INSERT INTO g2b_collection_attempts VALUES (
        1, 'contracts', 'LEGACY-DIAGNOSTICS', '00', '', '{}', '2026-11-01', '2026-11-01', 'failed', '이전 오류'
      );
    `);
    const attempts = openCollectionAttempts(db);
    const [legacy] = attempts.overview('contracts').failures;
    assert.equal(legacy.error, '이전 오류');
    assert.equal(legacy.diagnostics, null);
    const legacyRetry = attempts.start({ section: 'contracts', number: legacy.number, revision: '00' });
    attempts.finish(legacyRetry, 'failed', '새 오류', { name: 'Error', code: 'ECONNRESET' });
    assert.equal(JSON.parse(attempts.overview('contracts').failures[0].diagnostics).code, 'ECONNRESET');
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
    const mockKinds = [
      '모의공고&#40;등록공고&#41;', '모의공고&#40;변경공고&#41;',
      '모의공고&#40;재공고&#41;', ' 모의공고 ', '모의공고(등록공고)',
    ];
    for (let index = 0; index < 20; index++) {
      insert.run('RMOCK' + index, JSON.stringify({ title: '테스트 공고', payload: {
        dmItemMap: {
          pbancKndNm: mockKinds[index % mockKinds.length], prcmBsneSeCd: '02',
          rgnLmtYn: 'Y', rgnLmtCn: '[광주광역시]', alotBgtAmt: 1000,
        },
      } }));
    }
    insert.run('TREGULAR', JSON.stringify({ title: '테스트 공고', payload: {
      dmItemMap: { pbancKndNm: '일반공고', alotBgtAmt: 999 },
    } }));
    const publicOptions = { excludeMockNotices: true };
    const list = attempts.noticeList;
    assert.ok(list.regions().includes('광주광역시'));
    assert.ok(list.businesses().some(({ value }) => value === '02'));
    assert.ok(!list.regions(publicOptions).includes('광주광역시'));
    assert.ok(!list.businesses(publicOptions).some(({ value }) => value === '02'));
    const publicQuery = parseNoticeListQuery({ status: 'collected', sort: 'budget-desc' }, [], []);
    assert.equal(list.page(publicQuery).totalPages, 3);
    const publicPage = list.page(publicQuery, publicOptions);
    assert.deepEqual(publicPage.counts, { total: 26, collected: 25, uncollected: 1 });
    assert.equal(publicPage.totalPages, 2);
    assert.ok(publicPage.rows.some(({ number }) => number === 'TREGULAR'));
    assert.ok(list.page({ ...publicQuery, page: 2 }, publicOptions).rows.some(({ number }) => number === 'N01'));
    assert.deepEqual(list.page(parseNoticeListQuery({ q: '테스트 공고' }, [], []), publicOptions)
      .rows.map(({ number }) => number), ['TREGULAR']);
  } finally {
    databases.delete(db);
    db.close();
  }
});

test('수집 이력에서 네트워크 하위 원인과 각각의 스택을 확인한다', async () => {
  const { trackCollectionAttempt } = require('../src/features/collect-g2b/api/collection-attempt');
  const { postG2b } = require('../src/features/collect-g2b/api/request');
  const target = { section: 'contracts', number: 'DIAGNOSTICS-RESET', revision: '00' };
  const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', syscall: 'read' });
  const error = new TypeError('fetch failed', { cause });
  await assert.rejects(
    trackCollectionAttempt(target, () => postG2b('/test.do', 'test', {}, async () => { throw error; })),
    error,
  );
  const attempt = repository.collectionAttempts.overview('contracts').failures.find(({ number }) => number === target.number);
  const diagnostics = JSON.parse(attempt.diagnostics);
  assert.equal(diagnostics.request.path, '/test.do');
  assert.equal(diagnostics.cause.code, 'ECONNRESET');
  assert.match(diagnostics.stack, /TypeError: fetch failed/);
  assert.match(diagnostics.cause.stack, /Error: read ECONNRESET/);
});

test('관리자 목록은 업무 오류, HTTP 오류, JSON 파싱 진단을 접힌 아코디언으로 제공한다', async () => {
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { CollectionFailureDetails } = require('../src/_pages/admin/g2b/ui/CollectionFailureDetails');
  const { trackCollectionAttempt } = require('../src/features/collect-g2b/api/collection-attempt');
  const { postG2b } = require('../src/features/collect-g2b/api/request');
  const cases = [
    [Response.json({ ErrorCode: 'E-42', ErrorMsg: '품목 조회 권한 없음. Authorization: Bearer secret-value' }), 200, '나라장터 업무 응답'],
    [new Response('<html>raw-private-body</html>', { status: 503 }), 503, 'HTTP 응답'],
    [new Response('{"number": raw-private-body}', { headers: { 'Content-Type': 'application/json' } }), 200, 'JSON 해석'],
    [new Response('{"number":"raw-private-body"}_', { headers: { 'Content-Type': 'application/json' } }), 200, 'JSON 해석'],
  ];
  for (const [index, [response, status, step]] of cases.entries()) {
    const target = { section: 'contracts', number: 'DIAGRESPONSE' + index, revision: '00' };
    await assert.rejects(trackCollectionAttempt(target, () => postG2b('/test.do', 'test', {}, async () => response)));
    const query = parseContractListQuery({ status: 'uncollected', field: 'number', q: target.number }, []);
    const row = repository.collectionAttempts.contractList.page(query).rows.find(({ number }) => number === target.number);
    const diagnostic = JSON.parse(row.diagnostics);
    assert.equal(diagnostic.step, step);
    assert.equal(diagnostic.response.status, status);
    assert.doesNotMatch(row.diagnostics, /secret-value|raw-private-body/);
    const html = renderToStaticMarkup(createElement(CollectionFailureDetails, { diagnostics: row.diagnostics }));
    const [, triggerAttributes] = html.match(/<button\b([^>]*)>원인 보기/) ?? [];
    assert.ok(triggerAttributes, '원인 보기 버튼이 있어야 한다');
    assert.match(triggerAttributes, /\baria-expanded="false"/);
    const [, triggerId] = triggerAttributes.match(/\sid="([^"]+)"/) ?? [];
    assert.ok(triggerId, '원인 보기 버튼에 패널이 참조할 ID가 있어야 한다');
    const panel = html.match(/<div\b[^>]*\brole="region"[^>]*>/)?.[0] ?? '';
    assert.ok(panel.includes(`aria-labelledby="${triggerId}"`));
    assert.match(panel, /\bhidden=""/);
    assert.doesNotMatch(html, /스택 보기/);
    assert.ok(diagnostic.stack);
    if (index === 0) {
      assert.equal(diagnostic.response.errorCode, 'E-42');
      assert.match(diagnostic.response.errorMessage, /품목 조회 권한 없음/);
    } else if (index === 1) {
      assert.equal(diagnostic.response.errorMessage, undefined);
    } else {
      assert.equal(diagnostic.name, 'SyntaxError');
      assert.equal(diagnostic.details?.['오류 위치'], index === 3 ? 29 : undefined);
    }
  }
});

test('계약현황의 응답 키 불일치와 실제 SQLite 저장 오류를 기록한다', async (t) => {
  const { collectContract } = require('../src/features/collect-g2b/server');
  const key = { number: 'DIAG-SQLITE', revision: '00' };
  let number = 'DIAG-OTHER';
  mockFetch(t, () => success({
    dlCtrtMngLstM: { ctrtNo: number, ctrtChgOrd: 0 },
    dlCtrtEtpsLstL: [], dlCtrtEtpsSvsLstL: [], dlCtrtItemLstL: [],
  }));
  const latest = () => JSON.parse(repository.collectionAttempts.overview('contracts').failures
    .find((row) => row.number === key.number).diagnostics);
  await assert.rejects(collectContract(key, true));
  assert.equal(latest().details['기대한 번호'], key.number);
  assert.equal(latest().details['응답 번호'], number);

  number = key.number;
  const db = [...databases][0];
  db.exec(`CREATE TRIGGER diagnostic_contract_failure BEFORE INSERT ON contracts
    WHEN NEW.number = 'DIAG-SQLITE' BEGIN SELECT RAISE(ABORT, 'diagnostic constraint'); END;`);
  try {
    await assert.rejects(collectContract(key, true), /diagnostic constraint/);
    const diagnostic = latest();
    assert.equal(diagnostic.step, 'SQLite 계약현황 저장');
    assert.equal(diagnostic.code, 'ERR_SQLITE_ERROR');
    assert.equal(typeof diagnostic.errcode, 'number');
    assert.match(diagnostic.stack, /diagnostic constraint/);
  } finally {
    db.exec('DROP TRIGGER diagnostic_contract_failure');
  }
});

test('진단 이력 저장도 실패하면 두 원인을 기록하고 원래 예외를 전달한다', async (t) => {
  const { trackCollectionAttempt } = require('../src/features/collect-g2b/api/collection-attempt');
  const target = { section: 'contracts', number: 'DIAGHISTORYFAIL', revision: '00' };
  const collectError = new Error('connection reset');
  const finishError = new Error('history write failed');
  t.mock.method(repository.collectionAttempts, 'finish', () => { throw finishError; });
  const log = t.mock.method(console, 'error', () => {});
  await assert.rejects(trackCollectionAttempt(target, async () => { throw collectError; }), (error) => error === collectError);
  assert.equal(log.mock.callCount(), 1);
  const args = log.mock.calls[0].arguments;
  assert.equal(args[4].message, collectError.message);
  assert.equal(args[5].message, finishError.message);
});

test('큐 관리 API가 실행 중 수동 중단 요청을 저장하고 등록 오류는 503으로 반환한다', async (t) => {
  const { GET, PATCH } = require('../app/api/g2b/notice-queue/route');
  const response = await postNotice(noticeRequest());
  assert.equal(response.status, 202);
  const { jobId } = await response.json();
  assert.equal(queue.claim(Date.now()).id, jobId);
  const pause = await PATCH(new Request('http://localhost', { method: 'PATCH', body: '{"manual":true}' }));
  assert.equal(pause.status, 204);
  assert.equal((await GET().json()).active, jobId);
  assert.equal((await GET().json()).manual, true);
  queue.finish(jobId, { kind: 'success', related: [], result: {} }, Date.now());
  assert.equal((await GET().json()).active, null);

  const log = t.mock.method(console, 'error', () => {});
  t.mock.method(queue, 'enqueue', () => { throw new Error('DB 쓰기 실패'); });
  assert.equal((await postNotice(noticeRequest())).status, 503);
  const entry = JSON.parse(log.mock.calls[0].arguments[0]);
  assert.equal(entry.operation, 'enqueue');
  assert.equal(entry.diagnostic.message, 'DB 쓰기 실패');
});

test('기초금액과 전용 공지를 공고 수집 시 저장하고 재수집 실패 및 정상 제거를 구분한다', async (t) => {
  const input = { number: 'R26BK01789731', revision: '000', methodCode: '' };
  const identity = { bidPbancNo: input.number, bidPbancOrd: input.revision };
  const postKey = { bbsNo: 'R23AB00000204', pstNo: '17211' };
  const group = '12345678-1234-1234-1234-123456789abc';
  const attachment = { untyAtchFileNo: group, atchFileSqno: '1', scrnIndtYn: 'Y',
    dwnldPrmsYn: 'Y', orgnlAtchFileNm: '공지.hwp', atchFilePathNm: '/data/Attachfiles/public/notice.hwp' };
  const baseResult = {
    bidInfo: { ...identity, prcmBsneSeCd: '01', bidPbancNm: '테스트 기초금액' },
    baseEstiPrice: {}, listBaseEstiPrice: [{ ...identity, bidClsfNo: '1', bsamt: 28600000 }],
  };
  let hideButton = false;
  let failBase = false;
  let omitPost = false;
  let baseCalls = 0;
  t.mock.method(console, 'error', () => {});
  mockFetch(t, (path, options) => {
    if (path === '/') return session();
    if (path.endsWith('/srchWorkPrgs.do')) return success({ dlWorkPrgsL: [] });
    const body = JSON.parse(options.body);
    if (path.endsWith('/selectItemAnncMngV.do')) return success({
      dmItemMap: { ...baseResult.bidInfo, pnprDcsnMthoCd: hideButton ? '예050001' : '예050003' },
      dmItemBaseAmtList: [{ baseAmt: 28600000 }],
    });
    if (path.endsWith('/selectBaseAmtDtlPopup.do')) {
      baseCalls++;
      assert.deepEqual(body.dlBsisAmtM, { ...identity, sign: '', sign2: '', sign3: '' });
      return failBase ? new Response(null, { status: 502 }) : success({ result: baseResult });
    }
    if (path.endsWith('/selectNtcPstList.do')) {
      const map = body.dlPstM;
      if (!map.clsfPritmSqno) return success({ dlPstL: [] });
      assert.deepEqual(map, { bbsNo: postKey.bbsNo, clsfPritmSqno: '1721', odn1ColCn: input.number, odn2ColCn: input.revision });
      return success({ dlPstL: omitPost ? [] : [{ ...postKey, pstNm: '기초금액 안내' }] });
    }
    if (path.endsWith('/selectPst.do')) return success({ dlPstM: { ...postKey, untyAtchFileNo: group } });
    if (path.endsWith('/selectPstCn.do')) return success({ dlPstCnM: { ...postKey, bulkPstCn: '<p>안내</p>' } });
    if (path.endsWith('/selectUntyAtchFileList.do')) return success({ dlUntyAtchFileL: [attachment] });
    assert.fail(path);
  });
  await collectSingleNotice(input);
  const saved = await repository.find(input);
  assert.deepEqual(saved.baseAmount.detail.result, baseResult);
  assert.equal(saved.posts.entries.length, 0);
  assert.equal(saved.baseAmount.posts.entries[0].body.dlPstCnM.bulkPstCn, '<p>안내</p>');

  const { downloadNoticePost } = require('../src/features/download-g2b-attachment/server/notice-post-handler');
  // 조회 워커의 SQLite에 있는 원본만 첨부 다운로드에 사용한다.
  const download = (source) => downloadNoticePost(
    new Request('http://localhost/post-download?' + new URLSearchParams({ ...postKey, seq: '1', ...source })),
    { params: Promise.resolve(input) },
  );
  assert.equal((await download({ source: 'base-amount' })).status, 302);
  assert.equal((await download()).status, 404);

  failBase = true;
  omitPost = true;
  await collectSingleNotice(input, true);
  const retried = await repository.find(input);
  assert.deepEqual(retried.baseAmount.detail.result, baseResult);
  assert.deepEqual(retried.baseAmount.retained, ['detail']);
  assert.equal(retried.baseAmount.posts.entries.length, 0);
  assert.equal((await download({ source: 'base-amount' })).status, 404);

  hideButton = true;
  await collectSingleNotice(input);
  assert.equal((await repository.find(input)).baseAmount, undefined);
  assert.equal(baseCalls, 2);
});
