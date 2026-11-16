require('../scripts/register-project-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('정기 호출은 인증하고 실행 가능한 작업만 호출하며 실패한 호출은 다음 요청에서 복구한다', async (t) => {
  process.env.TURSO_DATABASE_URL = ':memory:';
  process.env.TURSO_AUTH_TOKEN = 'test-token';
  process.env.NOTICE_WORKER_MODE = 'github-actions';
  process.env.NOTICE_CRON_TOKEN = 'cron-test-token';
  process.env.NOTICE_GITHUB_TOKEN = 'github-test-token';
  process.env.NOTICE_GITHUB_REPOSITORY = 'example/test';
  process.env.NOTICE_GITHUB_REF = 'main';
  const { getG2bDatabase, getG2bRepository } = require('../src/server/g2b/repository');
  const { migrateG2bDatabase } = require('../src/server/g2b/repository/migrations');
  const { POST } = require('../app/api/g2b/notice-queue/tick/route');
  const { PATCH } = require('../app/api/g2b/notice-queue/automatic/route');
  const { acceptNoticeJob } = require('../src/features/collect-g2b/api/notice-queue-service');
  const { runNoticeWorker } = require('../src/features/collect-g2b/api/notice-worker');
  const { noticeKoreanMinute } = require('../src/features/collect-g2b/model/notice-automatic');
  const { client } = getG2bDatabase();
  const originalFetch = global.fetch;
  const calls = [];
  let fail = true;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: fail ? 502 : 204 });
  };
  const tick = (token = 'cron-test-token') => POST(new Request('http://localhost', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  }));
  try {
    await migrateG2bDatabase(client);
    assert.equal((await tick('wrong')).status, 401);
    assert.equal((await tick()).status, 204);
    assert.equal(calls.length, 0);

    const accepted = await acceptNoticeJob({ number: 'M', revision: '000', methodCode: '' });
    assert.equal(accepted.status, 202);
    assert.equal(calls.length, 1);
    fail = false;
    const responses = await Promise.all([tick(), tick()]);
    assert.deepEqual(responses.map(({ status }) => status).sort(), [202, 204]);
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /example\/test\/actions\/workflows\/notice-collection.yml\/dispatches$/);
    const processed = [];
    await runNoticeWorker(new AbortController().signal, async (job) => {
      processed.push(job.input.number);
      return { kind: 'success', related: [], result: {} };
    }, undefined, { once: true });
    assert.deepEqual(processed, ['M']);
    assert.equal((await getG2bRepository().noticeQueue.get((await accepted.json()).jobId)).status, 'succeeded');
    assert.equal((await tick()).status, 204);
    assert.equal(calls.length, 2);

    const patch = (body) => PATCH(new Request('http://localhost', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    const startMinute = noticeKoreanMinute(Date.now() - 60_000);
    const start = { action: 'start', interval: 30, startMinute };
    assert.equal((await patch(start)).status, 200);
    assert.equal(calls.length, 3);
    const discover = async (from) => {
      assert.equal(from, startMinute);
      return [];
    };
    await runNoticeWorker(new AbortController().signal, undefined, discover, { once: true });
    assert.equal((await tick()).status, 204);
    assert.equal((await patch({ action: 'stop' })).status, 200);
    assert.equal((await patch(start)).status, 200);
    assert.equal(calls.length, 4);
    // GitHub가 요청을 받았지만 러너가 시작하지 않은 경우 정기 호출이 만료 예약을 복구한다.
    await client.execute('UPDATE g2b_notice_queue SET dispatchUntil = unixepoch() - 1');
    assert.equal((await tick()).status, 202);
    assert.equal(calls.length, 5);
    await runNoticeWorker(new AbortController().signal, undefined, discover, { once: true });
    // 정상 정기 회차 자체도 실행 가능한 작업으로 판단한다.
    await client.execute('UPDATE g2b_notice_automatic SET nextAt = 0');
    assert.equal((await tick()).status, 202);
    assert.equal(calls.length, 6);

    // 워커가 정기 점검 확인을 접수한 뒤 종료되어도 다음 인증 호출이 확인을 다시 실행한다.
    const queue = getG2bRepository().noticeQueue;
    await queue.releaseWorkerDispatch();
    await queue.markMaintenance();
    const scheduledCheck = await queue.automatic.tick();
    assert.ok(scheduledCheck);
    assert.equal((await tick()).status, 202);
    const resumed = await queue.automatic.tick();
    assert.deepEqual(resumed, scheduledCheck);
    await queue.automatic.finishMaintenanceCheck(resumed);
    await queue.releaseWorkerDispatch();
    assert.equal((await tick()).status, 204);

    await t.test('단발 워커는 가까운 재시도를 처리하고 먼 재시도는 다음 호출에 넘긴다', async () => {
      await queue.automatic.update({ action: 'stop' });
      await queue.clearMaintenance(scheduledCheck.maintenance);
      const targets = ['far', 'near'].map((number) => ({ number, revision: '000', methodCode: '' }));
      const [far, near] = await queue.enqueue(targets, true);
      const now = Date.now();
      for (const id of [far, near]) {
        assert.equal((await queue.claim(now)).id, id);
        await queue.finish(id, { kind: 'failure', error: '일시 실패' }, now);
      }
      const distant = now + 6 * 60 * 60_000;
      await client.execute({ sql: 'UPDATE g2b_notice_jobs SET availableAt = ? WHERE id = ?', args: [distant, far] });
      await client.execute({ sql: 'UPDATE g2b_notice_jobs SET availableAt = ? WHERE id = ?', args: [Date.now() + 100, near] });
      const deadline = AbortSignal.timeout(3000);
      const executed = [];
      const execute = async (job) => {
        executed.push(job.id);
        return { kind: 'success', related: [], result: {} };
      };
      await runNoticeWorker(deadline, execute, undefined, { once: true });
      assert.equal(deadline.aborted, false, '먼 재시도를 기다리다 제한 시간에 도달했다');
      assert.deepEqual(executed, [near]);
      const deferred = await queue.get(far);
      assert.deepEqual([deferred.status, deferred.availableAt, deferred.failures], ['retry_wait', distant, 1]);
      assert.equal((await tick()).status, 204);

      await client.execute({ sql: 'UPDATE g2b_notice_jobs SET availableAt = ? WHERE id = ?', args: [Date.now() - 1, far] });
      assert.equal((await tick()).status, 202);
      await runNoticeWorker(new AbortController().signal, execute, undefined, { once: true });
      assert.deepEqual(executed, [near, far]);
      assert.equal((await queue.get(far)).status, 'succeeded');
    });
  } finally {
    global.fetch = originalFetch;
    client.close();
  }
});

test('정리 작업은 완료 후 24시간이 지난 성공만 삭제하고 실패한 재실행 이력도 보존한다', async () => {
  const { cleanupNoticeRuns } = require('../scripts/cleanup-notice-actions.cjs');
  const now = Date.parse('2026-11-16T10:00:00Z');
  const old = '2026-11-15T10:00:00Z';
  const run = (id, extra = {}) => ({ id, status: 'completed', conclusion: 'success', run_attempt: 1, updated_at: old, ...extra });
  const pages = [
    [run(1), run(2, { updated_at: '2026-11-15T10:00:01Z' }), run(3, { conclusion: 'failure' })],
    [run(4, { run_attempt: 2 }), run(5), run(6, { status: 'in_progress' })],
  ];
  const deleted = [];
  const request = async (path, method = 'GET') => {
    if (path.includes('page=1&')) return { runs: pages[0], next: true };
    if (path.includes('page=2&')) return { runs: pages[1], next: false };
    if (method === 'DELETE') return deleted.push(Number(path.split('/').at(-1)));
    if (path.endsWith('/4/attempts/1')) return { conclusion: 'failure' };
    if (path.endsWith('/4')) return run(4, { run_attempt: 2 });
    if (path.endsWith('/5')) return run(5, { status: 'in_progress' });
    return run(1);
  };
  assert.deepEqual(await cleanupNoticeRuns(request, now, true), [1]);
  assert.deepEqual(deleted, []);
  assert.deepEqual(await cleanupNoticeRuns(request, now), [1]);
  assert.deepEqual(deleted, [1]);
});
