require('../scripts/register-project-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { G2bDatabase } = require('../src/server/g2b/repository/database');
const { migrateG2bDatabase } = require('../src/server/g2b/repository/migrations');
async function testDatabase() {
  const client = createClient({ url: ':memory:' });
  await migrateG2bDatabase(client);
  return new G2bDatabase(client);
}
const { openNoticeQueue } = require('../src/server/g2b/repository/notice-queue.ts');

test('큐 조회는 버전 4 업그레이드 후 인덱스로 최근 50건을 정렬한다', async () => {
  const db = await testDatabase();
  const queue = openNoticeQueue(db);
  const explain = async (client) => (await client.execute(
    "EXPLAIN QUERY PLAN SELECT * FROM g2b_notice_jobs ORDER BY status = 'running' DESC, id DESC LIMIT 50",
  )).rows.map(({ detail }) => detail).join('\n');

  try {
    // 버전 5의 변경만 되돌려 작업 이력이 남아 있는 버전 4 상태를 재현한다.
    await db.client.executeMultiple(`
      DROP INDEX IF EXISTS g2b_notice_jobs_overview;
      DELETE FROM g2b_schema_migrations WHERE version = 5;
    `);
    assert.match(await explain(db.client), /USE TEMP B-TREE FOR ORDER BY/);
    assert.deepEqual((await queue.overview()).jobs, []);

    await db.client.execute(`
      WITH RECURSIVE ids(id) AS (VALUES (1) UNION ALL SELECT id + 1 FROM ids WHERE id < 60)
      INSERT INTO g2b_notice_jobs (id, number, revision, input, force, status)
      SELECT id, 'R26BK' || id, '000', '{}', 0, CASE WHEN id = 1 THEN 'running' ELSE 'pending' END
      FROM ids
    `);

    await migrateG2bDatabase(db.client);
    await migrateG2bDatabase(db.client);

    const upgradedPlan = await explain(db.client);
    assert.match(upgradedPlan, /USING INDEX g2b_notice_jobs_overview/);
    assert.doesNotMatch(upgradedPlan, /USE TEMP B-TREE FOR ORDER BY/);
    const fresh = await testDatabase();
    try {
      assert.equal(await explain(fresh.client), upgradedPlan);
    } finally {
      fresh.client.close();
    }

    const recentIds = Array.from({ length: 50 }, (_, index) => 60 - index);
    const running = await queue.overview();
    assert.equal(running.active, 1);
    assert.deepEqual(running.jobs.map(({ id }) => id), [1, ...recentIds.slice(0, 49)]);

    await db.client.execute("UPDATE g2b_notice_jobs SET status = 'succeeded' WHERE id = 1");
    const idle = await queue.overview();
    assert.equal(idle.active, null);
    assert.deepEqual(idle.jobs.map(({ id }) => id), recentIds);

    await db.client.execute('DELETE FROM g2b_notice_jobs WHERE id > 3');
    assert.deepEqual((await queue.overview()).jobs.map(({ id }) => id), [3, 2, 1]);
  } finally {
    db.client.close();
  }
});

test('기간 실행은 최초 건수를 고정하고 재시도와 연관 공고를 같은 실행으로 집계한다', async () => {
  const db = await testDatabase();
  const queue = openNoticeQueue(db);
  const period = { startMinute: '2026-11-11T23:30', endMinute: '2026-11-11T23:59' };
  const initial = { number: 'R26BK1', revision: '000', methodCode: '', title: '초기 공고' };
  const related = { ...initial, revision: '001', title: '' };
  const id = await queue.enqueueRun(period, 'request-a');
  assert.equal(await queue.enqueueRun(period, 'request-a'), id);
  assert.equal((await queue.getRun(id)).initialCount, null);
  assert.equal((await queue.claimRun()).id, id);
  await queue.recover();
  assert.equal((await queue.claimRun()).id, id);
  await queue.finishRun(id, { kind: 'targets', targets: [initial, initial] });
  assert.equal((await queue.getRun()).initialCount, 1);
  const parent = await queue.claim(0);
  await queue.finish(parent.id, { kind: 'failure', error: '일시 오류', related: [related] }, 0);
  assert.equal((await queue.getRun(id)).totalCount, 2);
  assert.equal((await queue.getRun(id)).failedCount, 0);
  const child = await queue.claim(0);
  await queue.finish(child.id, { kind: 'success', related: [initial], result: { title: '연관 공고' } }, 0);
  assert.equal((await queue.getRun(id)).notices[1].title, '연관 공고');
  for (const now of [60000, 120000]) {
    assert.equal((await queue.claim(now)).id, parent.id);
    await queue.finish(parent.id, { kind: 'failure', error: '실패' }, now);
  }
  const done = await queue.getRun(id);
  assert.deepEqual([done.status, done.initialCount, done.totalCount, done.succeededCount, done.failedCount],
    ['completed', 1, 2, 1, 1]);
  assert.deepEqual(await queue.findRunNotice(initial.number, initial.revision), {
    ...initial, status: 'failed', error: '실패',
  });
  assert.equal(await queue.findRunNotice(initial.number, '999'), undefined);
  db.client.close();
});

test('목록 실패, 점검 대기, 정상 0건 및 등록 롤백을 구분한다', async () => {
  const db = await testDatabase();
  const queue = openNoticeQueue(db);
  const period = { startMinute: '2026-11-11T23:30', endMinute: '2026-11-11T23:59' };
  const id = await queue.enqueueRun(period);
  await queue.claimRun();
  await queue.finishRun(id, { kind: 'maintenance', error: '점검' });
  assert.equal((await queue.getRun(id)).pauseReason, 'maintenance');
  assert.equal(await queue.claimRun(), undefined);
  await queue.clearMaintenance(await queue.maintenanceVersion());
  await queue.claimRun();
  await db.client.executeMultiple("CREATE TRIGGER fail_visit BEFORE INSERT ON g2b_notice_walk_visits BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  await assert.rejects(() => queue.finishRun(id, { kind: 'targets', targets: [
    { number: 'R26BK1', revision: '000', methodCode: '', title: '공고' },
  ] }));
  assert.equal((await queue.getRun(id)).initialCount, null);
  assert.equal((await queue.overview()).jobs.length, 0);
  await queue.finishRun(id, { kind: 'failure', error: '목록 오류' });
  assert.equal((await queue.getRun(id)).status, 'failed');
  assert.equal((await queue.getRun(id)).failedCount, 0);
  const emptyId = await queue.enqueueRun(period);
  await queue.claimRun();
  await queue.finishRun(emptyId, { kind: 'targets', targets: [] });
  assert.equal((await queue.getRun(emptyId)).status, 'completed');
  assert.equal((await queue.getRun(emptyId)).initialCount, 0);
  db.client.close();
});

test('기간 수집 API 접수 후 워커가 초기 공고와 연관 공고를 자동 처리한다', async () => {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'notice-period-worker-'));
  const loader = require.resolve('../scripts/register-project-typescript.cjs');
  const api = require.resolve('../app/api/g2b/notice-collection-runs/route.ts');
  const byId = require.resolve('../app/api/g2b/notice-collection-runs/[id]/route.ts');
  const worker = require.resolve('../src/features/collect-g2b/api/notice-worker.ts');
  const code = `
    const assert = require('node:assert/strict');
    require(${JSON.stringify(loader)});
    const { POST, GET } = require(${JSON.stringify(api)});
    const byId = require(${JSON.stringify(byId)}).GET;
    const { runNoticeWorker } = require(${JSON.stringify(worker)});
    (async () => {
      process.env.TURSO_DATABASE_URL = ':memory:';
      process.env.TURSO_AUTH_TOKEN = 'test-token';
      const { getG2bDatabase } = require(${JSON.stringify(require.resolve('../src/server/g2b/repository/index.ts'))});
      await require(${JSON.stringify(require.resolve('../src/server/g2b/repository/migrations.ts'))}).migrateG2bDatabase(getG2bDatabase().client);
      const period = { startMinute: '2026-11-11T23:30', endMinute: '2026-11-11T23:59' };
      const post = (body) => POST(new Request('http://localhost', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'period-1' },
        body: JSON.stringify(body),
      }));
      assert.equal((await POST(new Request('http://localhost', {
        method: 'POST', body: JSON.stringify(period),
      }))).status, 415);
      assert.equal((await post({ ...period, endMinute: '2026-02-30T10:00' })).status, 400);
      assert.equal(await (await GET()).json(), null);
      const accepted = await post(period);
      assert.equal(accepted.status, 202);
      const { id } = await accepted.json();
      assert.equal(accepted.headers.get('Location'), '/api/g2b/notice-collection-runs/' + id);
      assert.equal((await (await post(period)).json()).id, id);
      assert.equal((await post({ ...period, endMinute: '2026-11-12T00:00' })).status, 409);
      assert.equal((await (await GET()).json()).status, 'pending');
      assert.equal((await byId(new Request('http://localhost/'), { params: Promise.resolve({ id: '999' }) })).status, 404);

      const stop = new AbortController();
      const input = { number: 'R26BK1', revision: '000', methodCode: '', title: '최초 공고' };
      const child = { ...input, revision: '001', title: '' };
      let discoveries = 0;
      await runNoticeWorker(stop.signal, async ({ input }) => {
        if (input.revision === '000') return { kind: 'success', related: [child], result: {} };
        stop.abort();
        return { kind: 'internal_error', error: '상세 실패' };
      }, async (start, end) => {
        discoveries++;
        assert.deepEqual([start, end], [period.startMinute, period.endMinute]);
        return [input];
      });
      assert.equal(discoveries, 1);
      const readRun = (query = '') => byId(new Request('http://localhost/' + query), {
        params: Promise.resolve({ id: String(id) }),
      });
      const run = await (await readRun()).json();
      assert.deepEqual([run.status, run.initialCount, run.totalCount, run.succeededCount, run.failedCount],
        ['completed', 1, 2, 1, 1]);
      assert.equal(run.notices[1].error, '상세 실패');
      const { notices, ...expectedSummary } = run;
      assert.deepEqual(await (await readRun('?view=summary')).json(), expectedSummary);
      assert.deepEqual(await (await GET(new Request('http://localhost/?view=summary'))).json(), expectedSummary);
      assert.equal((await (await readRun('?kind=failed')).json()).items[0].error, '상세 실패');
      const numbered = await (await readRun('?kind=failed&page=2')).json();
      assert.deepEqual([numbered.page, numbered.totalPages, numbered.items.length], [1, 1, 1]);
      assert.equal((await readRun('?kind=failed&cursor=invalid')).status, 400);
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', code], { cwd: dir, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('실패 지연, 강제 승격, 중단 복구와 완료 후속 등록', async () => {
  const db = await testDatabase();
  const queue = openNoticeQueue(db);
  const key = { number: 'R26BK00000001', revision: '000', methodCode: '' };
  const related = { ...key, revision: '001' };
  const id = (await queue.enqueue([key], false))[0];
  assert.equal((await queue.claim(10)).id, id);
  await queue.finish(id, { kind: 'failure', error: '조회 실패' }, 10);
  assert.equal(await queue.claim(60009), undefined);
  assert.equal((await queue.enqueue([key], true))[0], id);
  assert.equal((await queue.claim(Date.now())).failures, 0);
  await queue.recover();
  assert.equal((await queue.claim(Date.now())).id, id);
  await queue.finish(id, { kind: 'success', related: [related], result: {} }, 10);
  const child = await queue.claim(Date.now());
  assert.equal(child.input.revision, '001');
  await queue.finish(child.id, { kind: 'success', related: [key], result: {} }, 10);
  assert.equal(await queue.claim(Date.now()), undefined);
  db.client.close();
});

test('수동 중단과 점검을 따로 해제하고 일반 실패 세 번째에 종료한다', async () => {
  const db = await testDatabase();
  const queue = openNoticeQueue(db);
  const key = { number: 'R26BK00000002', revision: '000', methodCode: '' };
  const id = (await queue.enqueue([key], false))[0];
  await queue.setManual(true);
  await queue.markMaintenance();
  const version = await queue.maintenanceVersion();
  await queue.markMaintenance();
  await queue.clearMaintenance(version);
  await queue.setManual(false);
  assert.equal(await queue.claim(0), undefined);
  await queue.clearMaintenance(await queue.maintenanceVersion());
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = attempt * 60_000;
    assert.equal((await queue.claim(now)).id, id);
    await queue.finish(id, { kind: 'failure', error: '조회 실패' }, now);
  }
  assert.equal((await queue.get(id)).status, 'failed');
  assert.equal((await queue.get(id)).failures, 3);
  await queue.recover();
  assert.equal(await queue.claim(180_000), undefined);
  db.client.close();
});

test('큐 완료 기록 실패 시 같은 결과를 다시 기록하고 외부 수집을 반복하지 않는다', async () => {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'notice-worker-finish-'));
  const loader = require.resolve('../scripts/register-project-typescript.cjs');
  const worker = require.resolve('../src/features/collect-g2b/api/notice-worker.ts');
  const repository = require.resolve('../src/server/g2b/repository/index.ts');
  const tracker = require.resolve('../src/features/collect-g2b/api/collection-attempt.ts');
  const code = `
    const assert = require('node:assert/strict');
    require(${JSON.stringify(loader)});
    (async () => {
    process.env.TURSO_DATABASE_URL = ':memory:';
      process.env.TURSO_AUTH_TOKEN = 'test-token';
      const { getG2bDatabase } = require(${JSON.stringify(require.resolve('../src/server/g2b/repository/index.ts'))});
      await require(${JSON.stringify(require.resolve('../src/server/g2b/repository/migrations.ts'))}).migrateG2bDatabase(getG2bDatabase().client);
    const { noticeQueue: queue, collectionAttempts } = require(${JSON.stringify(repository)}).getG2bRepository();
    const { trackCollectionAttempt } = require(${JSON.stringify(tracker)});
    const stop = new AbortController();
    const [id] = await queue.enqueue([{ number: 'R26BK00000003', revision: '000', methodCode: '' }], true);
    const [nextId] = await queue.enqueue([{ number: 'R26BK00000005', revision: '000', methodCode: '' }], true);
    const executions = [];
    let writes = 0;
    const execute = async (job) => {
      executions.push(job.id);
      if (job.id === id) {
        await collectionAttempts.start({ section: 'notices', ...job.input }, id);
        throw new Error('injected execution error');
      }
      assert.equal((await queue.get(id)).status, 'failed');
      await trackCollectionAttempt({ section: 'notices', ...job.input }, async () => {});
      const pending = (await collectionAttempts.overview('notices')).failures.find((attempt) => attempt.number === job.input.number);
      assert.equal(pending.status, 'pending');
      return { kind: 'success', related: [], result: { noticeSaved: true } };
    };
    const finish = queue.finish;
    queue.finish = async (...args) => {
      if (++writes === 1) throw new Error('injected write error');
      await finish(...args);
      if (args[0] === nextId) stop.abort();
    };
    require(${JSON.stringify(worker)}).runNoticeWorker(stop.signal, execute).then(async () => {
      assert.deepEqual(executions, [id, nextId]);
      assert.equal(writes, 3);
      assert.equal((await queue.get(id)).status, 'failed');
      assert.equal((await queue.get(id)).failures, 0);
      assert.equal((await queue.get(nextId)).status, 'succeeded');
      assert.equal((await collectionAttempts.overview('notices')).failures.length, 1);
      assert.equal((await collectionAttempts.overview('notices')).failures[0].status, 'failed');
    });
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', code], { cwd: dir, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.match(result.stderr, /"operation":"finish","jobId":1/);
    assert.match(result.stderr, /"operation":"execute-job","jobId":1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('저장 직후 중단된 작업과 미종료 이력만 복구하고 일반 실패 횟수를 보존한다', async () => {
  const db = await testDatabase();
  const queue = openNoticeQueue(db);
  const input = { number: 'R26BK00000004', revision: '000', methodCode: '' };
  const [id] = await queue.enqueue([input], true);
  await queue.claim(0);
  await queue.finish(id, { kind: 'failure', error: 'API 오류' }, 0);
  const [waiting] = await queue.enqueue([{ ...input, revision: '002' }], true);
  await queue.claim(0);
  await queue.finish(waiting, { kind: 'failure', error: 'API 오류' }, 30_000);
  await db.prepare("INSERT INTO g2b_collection_attempts (job_id, section, number, revision, opening_revision, input, started_at) VALUES (?, 'notices', '', '', '', '{}', '')").run(waiting);
  await db.client.executeMultiple("INSERT INTO g2b_collection_attempts (section, number, revision, opening_revision, input, started_at) VALUES ('notices', '', '', '', '{}', '')");
  await queue.claim(60_000);
  await db.prepare("INSERT INTO g2b_collection_attempts (job_id, section, number, revision, opening_revision, input, started_at) VALUES (?, 'notices', '', '', '', '{}', '')").run(id);
  await db.prepare("INSERT INTO notices VALUES (?, '', '', '{}', '{}')").run(input.number);
  await queue.recover();
  assert.equal((await queue.get(id)).status, 'pending');
  assert.equal((await queue.get(id)).failures, 1);
  assert.equal((await db.prepare('SELECT status FROM g2b_collection_attempts WHERE job_id = ?').get(id)).status, 'deferred');
  assert.equal((await db.prepare('SELECT status FROM g2b_collection_attempts WHERE job_id = ?').get(waiting)).status, 'deferred');
  assert.equal((await db.prepare('SELECT status FROM g2b_collection_attempts WHERE job_id IS NULL').get()).status, 'pending');
  assert.equal((await queue.get(waiting)).status, 'retry_wait');
  assert.equal((await queue.claim(60_000)).id, id);
  await db.prepare("INSERT OR IGNORE INTO notices VALUES (?, '', '', '{}', '{}')").run(input.number);
  await queue.finish(id, { kind: 'success', related: [{ ...input, revision: '001' }], result: {} }, 60_000);
  await queue.recover();
  assert.equal((await queue.get(id)).status, 'succeeded');
  assert.equal((await queue.claim(60_000)).input.revision, '001');
  assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM notices').get()).total, 1);
  db.client.close();
});

test('Attempt 종료와 후속 등록은 Job 상태와 함께 롤백되고 재시도에서 한 번만 반영된다', async () => {
  const db = await testDatabase();
  const queue = openNoticeQueue(db);
  const input = { number: 'R26BK00000006', revision: '000', methodCode: '' };
  const [id] = await queue.enqueue([input], true);
  await queue.claim(0);
  await db.prepare("INSERT INTO g2b_collection_attempts (id, job_id, section, number, revision, opening_revision, input, started_at) VALUES (1, ?, 'notices', '', '', '', '{}', ''), (2, ?, 'notices', '', '', '', '{}', '')").run(id, id);
  const finishedAt = new Date(0).toISOString();
  const attempts = [
    { id: 1, status: 'failed', error: '원래 오류', diagnostics: { name: 'Error', message: '원래 진단' }, finishedAt },
    { id: 2, status: 'succeeded', error: null, finishedAt },
  ];
  const outcome = { kind: 'failure', error: '부분 실패', related: [{ ...input, revision: '001' }] };
  const read = async () => await db.prepare('SELECT status, diagnostics FROM g2b_collection_attempts ORDER BY id').all();
  for (const table of ['g2b_collection_attempts', 'g2b_notice_jobs']) {
    await db.client.executeMultiple(`CREATE TRIGGER fail_write BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    await assert.rejects(() => queue.finish(id, outcome, 0, attempts), /injected/);
    assert.deepEqual((await read()).map((row) => row.status), ['pending', 'pending']);
    assert.equal((await queue.get(id)).status, 'running');
    assert.equal((await queue.overview()).jobs.length, 1);
    await db.client.executeMultiple('DROP TRIGGER fail_write');
  }
  await queue.finish(id, outcome, 0, attempts);
  await queue.finish(id, outcome, 0, attempts);
  assert.deepEqual((await read()).map((row) => row.status), ['failed', 'succeeded']);
  assert.deepEqual(JSON.parse((await read())[0].diagnostics), attempts[0].diagnostics);
  assert.equal((await queue.get(id)).status, 'retry_wait');
  assert.equal((await queue.get(id)).failures, 1);
  assert.equal((await queue.overview()).jobs.length, 2);
  db.client.close();
});

test('기간 탐색은 여러 페이지 분량을 순서대로 등록하고 강제 작업을 먼저 선점한다', async () => {
  const db = await testDatabase();
  try {
    const queue = openNoticeQueue(db);
    const targets = Array.from({ length: 320 }, (_, index) => ({
      number: 'R26BK' + String(index).padStart(8, '0'),
      revision: '000',
      methodCode: '',
      title: String(index),
    }));
    const run = await queue.enqueueRun({
      startMinute: '2026-11-11T00:00',
      endMinute: '2026-11-11T23:59',
    });
    const [forced] = await queue.enqueue([targets[10]], true);
    await queue.claimRun();
    await queue.finishRun(run, { kind: 'targets', targets: [...targets, targets[10]] });
    const registered = await queue.getRun(run);
    assert.equal(registered.initialCount, targets.length);
    assert.deepEqual(registered.notices.map(({ number }) => number), targets.map(({ number }) => number));
    assert.equal((await queue.claim(0)).id, forced);
    await queue.finish(forced, { kind: 'success', result: {}, related: [] }, 0);
    assert.equal((await queue.claim(0)).input.number, targets[0].number);
  } finally {
    db.client.close();
  }
});

test('자동 구간은 최초 상세 결과를 저장하면 재시도 결과 전에 완료 시각을 기록한다', async () => {
  const db = await testDatabase();
  try {
    const queue = openNoticeQueue(db);
    const period = { startMinute: '2026-11-11T23:30', endMinute: '2026-11-11T23:59' };
    const target = (number) => ({ number, revision: '000', methodCode: '', title: number });
    const id = await queue.enqueueRun(period, 'auto-window', 'automatic');
    await queue.claimRun();
    await queue.finishRun(id, { kind: 'targets', targets: ['R', 'A', 'B', 'C'].map(target) });

    assert.equal(await queue.getAutomaticCoveredThrough(), null);
    const retry = await queue.claim(0);
    assert.equal(retry.source, 'automatic');
    await queue.finish(retry.id, { kind: 'failure', error: '상세 실패' }, 0);

    const current = (await queue.claimNext(0, true)).job;
    assert.equal(current.input.number, 'A');
    const [manual] = await queue.enqueue([target('M')], true);
    const manualRun = await queue.enqueueRun(period);
    const pendingAutoRun = await queue.enqueueRun(period, 'pending-auto', 'automatic');
    assert.equal(await queue.claimNext(60000, true), undefined);
    await queue.finish(current.id, { kind: 'success', related: [], result: {} }, 60000);

    assert.equal((await queue.claimNext(60000, true)).job.id, manual);
    await queue.finish(manual, { kind: 'success', related: [], result: {} }, 60000);
    assert.equal((await queue.claimNext(60000, true)).run.id, manualRun);
    await queue.finishRun(manualRun, { kind: 'failure', error: '목록 조회 중단' });
    assert.equal((await queue.claimNext(60000, true)).job.id, retry.id);
    await queue.finish(retry.id, { kind: 'failure', error: '상세 실패' }, 60000);
    assert.equal((await queue.claimNext(60000, true)).run.id, pendingAutoRun);
    await queue.finishRun(pendingAutoRun, { kind: 'failure', error: '목록 조회 중단' });

    const next = await queue.claim(60000);
    assert.equal(next.input.number, 'B');
    await queue.finish(next.id, { kind: 'success', related: [], result: {} }, 60000);
    assert.equal(await queue.getAutomaticCoveredThrough(), null);
    const last = await queue.claim(60000);
    assert.equal(last.input.number, 'C');
    const outcome = { kind: 'success', related: [], result: {} };
    await db.client.executeMultiple("CREATE TRIGGER fail_coverage BEFORE UPDATE OF coveredThrough ON g2b_notice_runs BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    await assert.rejects(() => queue.finish(last.id, outcome, 60000), /test failure/);
    assert.equal(await queue.getAutomaticCoveredThrough(), null);
    assert.equal((await queue.get(last.id)).status, 'running');
    await db.client.execute("DROP TRIGGER fail_coverage");
    await queue.recover();
    assert.equal((await queue.claim(60000)).id, last.id);
    await queue.finish(last.id, outcome, 60000);

    assert.equal(await queue.getAutomaticCoveredThrough(), period.endMinute);
    assert.equal((await queue.getRun(id)).status, 'collecting');
    assert.equal((await queue.claim(120000)).id, retry.id);
    await queue.finish(retry.id, { kind: 'failure', error: '상세 실패' }, 120000);
    assert.equal((await queue.get(retry.id)).status, 'failed');

    const nextPeriod = { startMinute: period.endMinute, endMinute: '2026-11-12T00:30' };
    const failedRun = await queue.enqueueRun(nextPeriod, undefined, 'automatic');
    await queue.claimRun();
    await queue.finishRun(failedRun, { kind: 'failure', error: '목록 조회 중단' });
    assert.equal(await queue.getAutomaticCoveredThrough(), period.endMinute);

    const deferredRun = await queue.enqueueRun(nextPeriod, undefined, 'automatic');
    await queue.claimRun();
    await queue.finishRun(deferredRun, { kind: 'targets', targets: [target('D')] });
    const deferred = await queue.claim(120000);
    await queue.finish(deferred.id, { kind: 'maintenance', error: '점검' }, 120000);
    assert.equal((await queue.get(deferred.id)).failures, 0);
    assert.equal(await queue.getAutomaticCoveredThrough(), period.endMinute);
    assert.equal(await queue.claimNext(120000, true), undefined);
    await queue.clearMaintenance(await queue.maintenanceVersion());
    assert.equal((await queue.claim(120000)).id, deferred.id);
    await queue.finish(deferred.id, outcome, 120000);
    assert.equal(await queue.getAutomaticCoveredThrough(), nextPeriod.endMinute);
  } finally {
    db.client.close();
  }
});

test('자동 수집은 시작 기준 시각으로 스케줄을 계산하고 재개 이전 구간은 새 완료 시각에서 제외한다', async () => {
  const db = await testDatabase();
  try {
    const queue = openNoticeQueue(db);
    const time = (minute) => Date.parse(`${minute}:00+09:00`);
    const now = time('2026-11-12T12:20');
    await queue.automatic.update({ action: 'start', startMinute: '2026-11-12T10:00', interval: 60 }, now);
    assert.equal((await queue.automatic.get()).nextAt, time('2026-11-12T13:00'));
    await queue.automatic.tick(now);
    await queue.automatic.tick(now);
    const run = await queue.claimRun('automatic');
    assert.deepEqual([run.startMinute, run.endMinute], ['2026-11-12T10:00', '2026-11-12T12:20']);
    const target = { number: 'A', revision: '000', methodCode: '', title: '공고' };
    await queue.finishRun(run.id, { kind: 'targets', targets: [target, { ...target, number: 'B' }] });
    const active = await queue.claim(now);
    await queue.automatic.tick(time('2026-11-12T13:00'));
    assert.equal(await queue.claimRun('automatic'), undefined);
    await queue.automatic.update({ action: 'stop' }, now);
    await queue.finish(active.id, { kind: 'success', related: [], result: {} }, now);
    const [manual] = await queue.enqueue([{ ...target, number: 'M' }], true);
    assert.equal((await queue.claim(now)).id, manual);
    await queue.finish(manual, { kind: 'success', related: [], result: {} }, now);
    assert.equal(await queue.claim(now), undefined);
    await queue.automatic.update({ action: 'start', startMinute: '2026-11-12T09:00', interval: 60 }, now);
    await queue.automatic.tick(now);
    const resumed = await queue.claimRun('automatic');
    assert.deepEqual([resumed.startMinute, resumed.endMinute], ['2026-11-12T09:00', '2026-11-12T12:20']);
    await queue.finishRun(resumed.id, { kind: 'failure', error: '조회 중단' }, now);
    const remaining = await queue.claim(now);
    assert.equal(remaining.input.number, 'B');
    await queue.finish(remaining.id, { kind: 'success', related: [], result: {} }, now);
    await queue.automatic.update({ action: 'interval', interval: 30 }, now);
    assert.equal((await queue.automatic.get()).nextAt, time('2026-11-12T12:30'));
    await queue.automatic.tick(time('2026-11-12T12:30'));
    const next = await queue.claimRun('automatic');
    assert.deepEqual([next.startMinute, next.endMinute], ['2026-11-12T09:00', '2026-11-12T12:30']);
  } finally {
    db.client.close();
  }
});

test('자동 수집 상태는 실행 대기와 목록·상세·재시도 실행을 구분한다', async () => {
  const db = await testDatabase();
  try {
    const queue = openNoticeQueue(db);
    const now = Date.parse('2026-11-12T12:20:00+09:00');
    const status = async () => (await queue.automatic.get()).status;
    await queue.automatic.update({ action: 'start', interval: 60, startMinute: '2026-11-12T10:00' }, now);
    assert.equal(await status(), 'pending');
    await queue.automatic.tick(now);
    assert.equal(await status(), 'pending');
    const run = await queue.claimRun('automatic');
    assert.equal(await status(), 'running');
    await queue.finishRun(run.id, { kind: 'targets', targets: [
      { number: 'A', revision: '000', methodCode: '', title: '공고' },
    ] }, now);
    assert.equal(await status(), 'pending');
    const job = await queue.claim(now);
    assert.equal(await status(), 'running');
    await queue.finish(job.id, { kind: 'failure', error: '상세 조회 실패' }, now);
    assert.equal(await status(), 'pending');
    await queue.claim(now + 60_000);
    assert.equal(await status(), 'running');
    await queue.automatic.update({ action: 'stop' }, now + 60_000);
    assert.equal(await status(), 'stopping');
    await queue.finish(job.id, { kind: 'success', related: [], result: {} }, now + 60_000);
    assert.equal(await status(), 'stopped');
  } finally {
    db.client.close();
  }
});

test('같은 일정에서 목록 실패 다음 회차는 마지막 완료 시각부터 다시 조회한다', async () => {
  const db = await testDatabase();
  try {
    const queue = openNoticeQueue(db);
    const time = (minute) => Date.parse(`2026-11-12T${minute}:00+09:00`);
    await queue.automatic.update({ action: 'start', interval: 60, startMinute: '2026-11-12T10:00' }, time('10:20'));
    await queue.automatic.tick(time('10:20'));
    const first = await queue.claimRun('automatic');
    await queue.finishRun(first.id, { kind: 'targets', targets: [] }, time('10:20'));
    await queue.automatic.tick(time('11:00'));
    const failed = await queue.claimRun('automatic');
    assert.equal(failed.startMinute, first.endMinute);
    await queue.finishRun(failed.id, { kind: 'failure', error: '목록 중간 실패' }, time('11:01'));
    await queue.automatic.tick(time('12:00'));
    const recovered = await queue.claimRun('automatic');
    assert.deepEqual([recovered.startMinute, recovered.endMinute], [first.endMinute, '2026-11-12T12:00']);
    await queue.finishRun(recovered.id, { kind: 'targets', targets: [] }, time('12:00'));
    await queue.automatic.tick(time('13:00'));
    assert.equal((await queue.claimRun('automatic')).startMinute, recovered.endMinute);
  } finally {
    db.client.close();
  }
});

test('재개하면 신규 수동, 기존 자동 재시도, 기존·신규 자동 상세 순으로 처리한다', async () => {
  const db = await testDatabase();
  try {
    const queue = openNoticeQueue(db);
    const now = Date.parse('2026-11-12T12:20:00+09:00');
    const target = (number) => ({ number, revision: '000', methodCode: '', title: number });
    const success = { kind: 'success', related: [], result: {} };
    const start = { action: 'start', interval: 60, startMinute: '2026-11-12T10:00' };
    await queue.automatic.update(start, now);
    await queue.automatic.tick(now);
    const old = await queue.claimRun('automatic');
    await queue.finishRun(old.id, { kind: 'targets', targets: ['R', 'A', 'B'].map(target) }, now);
    const retry = await queue.claim(now);
    await queue.finish(retry.id, { kind: 'failure', error: '일시 오류' }, now);
    const ongoing = await queue.claim(now);
    assert.equal(ongoing.input.number, 'A');
    await queue.automatic.update({ action: 'stop' }, now);
    await queue.finish(ongoing.id, success, now);
    assert.equal(await queue.claim(now + 60_000), undefined);

    const resumedAt = now + 120_000;
    await queue.automatic.update({ ...start, startMinute: '2026-11-12T09:00' }, resumedAt);
    await queue.automatic.tick(resumedAt);
    const [manual] = await queue.enqueue([target('M')], true);
    assert.equal((await queue.claimNext(resumedAt, true)).job.id, manual);
    await queue.finish(manual, success, resumedAt);
    assert.equal((await queue.claimNext(resumedAt, true)).job.id, retry.id);
    await queue.finish(retry.id, success, resumedAt);
    const resumed = (await queue.claimNext(resumedAt, true)).run;
    await queue.finishRun(resumed.id, { kind: 'targets', targets: ['B', 'C'].map(target) }, resumedAt);
    const previous = (await queue.claimNext(resumedAt, false)).job;
    assert.equal(previous.input.number, 'B');
    await queue.finish(previous.id, success, resumedAt);
    assert.equal((await queue.getRun(old.id)).status, 'completed');
    assert.equal((await queue.getRun(resumed.id)).status, 'collecting');
    const current = (await queue.claimNext(resumedAt, true)).job;
    assert.equal(current.input.number, 'C');
    await queue.finish(current.id, success, resumedAt);
    assert.equal((await queue.getRun(resumed.id)).status, 'completed');
    assert.equal(await queue.claimNext(resumedAt, true), undefined);
    await queue.automatic.tick(Date.parse('2026-11-12T13:00:00+09:00'));
    assert.equal((await queue.claimRun('automatic')).startMinute, resumed.endMinute);
  } finally {
    db.client.close();
  }
});

test('늦게 확인한 겹친 정기 회차는 건너뛰고 점검은 다음 정기 시각에만 확인한다', async () => {
  const db = await testDatabase();
  try {
    const queue = openNoticeQueue(db);
    const time = (minute) => Date.parse(`2026-11-12T${minute}:00+09:00`);
    const start = '2026-11-12T10:00';
    await queue.automatic.update({ action: 'start', startMinute: start, interval: 120 }, time('10:20'));
    await queue.automatic.tick(time('10:20'));
    const immediate = await queue.claimRun();
    await queue.finishRun(immediate.id, { kind: 'targets', targets: [] }, time('12:01'));
    await queue.automatic.tick(time('12:01'));
    assert.equal(await queue.claimRun(), undefined);
    assert.equal((await queue.automatic.get()).nextAt, time('14:00'));

    await queue.markMaintenance();
    assert.equal(await queue.automatic.tick(time('13:59')), undefined);
    const firstCheck = await queue.automatic.tick(time('14:00'));
    assert.equal(firstCheck.maintenance, await queue.maintenanceVersion());
    assert.deepEqual(await queue.automatic.tick(time('14:01')), firstCheck);
    await queue.automatic.finishMaintenanceCheck(firstCheck);
    assert.equal(await queue.automatic.tick(time('14:01')), undefined);
    await queue.clearMaintenance(firstCheck.maintenance);
    assert.equal((await queue.automatic.get()).status, 'maintenance');
    assert.equal(await queue.claimRun(), undefined);

    const nextCheck = await queue.automatic.tick(time('16:00'));
    await queue.clearMaintenance(nextCheck.maintenance, nextCheck.generation);
    const recovered = await queue.claimRun();
    assert.deepEqual([recovered.startMinute, recovered.endMinute], ['2026-11-12T10:20', '2026-11-12T16:00']);
    await queue.finishRun(recovered.id, { kind: 'targets', targets: [] }, time('16:00'));
    await queue.automatic.update({ action: 'stop' }, time('16:00'));
    await queue.markMaintenance();
    assert.equal(await queue.needsManualMaintenanceCheck(), false);
    const [manual] = await queue.enqueue([{ number: 'M', revision: '000', methodCode: '' }], true);
    assert.equal(await queue.needsManualMaintenanceCheck(), true);
    await queue.clearMaintenance(await queue.maintenanceVersion());
    assert.equal((await queue.claim(time('16:00'))).id, manual);
  } finally {
    db.client.close();
  }
});

test('자동 수집 설정 API에서 시작과 중단을 접수하고 워커가 즉시 목록을 조회한다', () => {
  const { spawnSync } = require('node:child_process');
  const loader = require.resolve('../scripts/register-project-typescript.cjs');
  const api = require.resolve('../app/api/g2b/notice-queue/automatic/route.ts');
  const listApi = require.resolve('../app/api/g2b/notice-queue/automatic/notices/route.ts');
  const worker = require.resolve('../src/features/collect-g2b/api/notice-worker.ts');
  const repository = require.resolve('../src/server/g2b/repository/index.ts');
  const migrations = require.resolve('../src/server/g2b/repository/migrations.ts');
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    require(${JSON.stringify(loader)});
    process.env.TURSO_DATABASE_URL = ':memory:';
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    const { GET, PATCH } = require(${JSON.stringify(api)});
    const { GET: list } = require(${JSON.stringify(listApi)});
    const { runNoticeWorker } = require(${JSON.stringify(worker)});
    const { getG2bDatabase, getG2bRepository } = require(${JSON.stringify(repository)});
    const { migrateG2bDatabase } = require(${JSON.stringify(migrations)});
    (async () => {
      await migrateG2bDatabase(getG2bDatabase().client);
      const patch = (body) => PATCH(new Request('http://localhost', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }));
      assert.equal((await (await GET()).json()).status, 'stopped');
      const command = { action: 'start', interval: 30, startMinute: '2020-01-01T11:20' };
      assert.equal((await patch({ ...command, interval: 31 })).status, 400);
      assert.equal((await patch({ ...command, startMinute: '2020-02-30T11:20' })).status, 400);
      assert.equal((await patch({ ...command, startMinute: '2099-01-01T11:20' })).status, 400);
      assert.equal((await patch(command)).status, 200);
      const stop = new AbortController();
      let discoveries = 0;
      await runNoticeWorker(stop.signal, async () => {
        stop.abort();
        return { kind: 'success', related: [], result: {} };
      }, async (start, end) => {
        discoveries++;
        assert.equal(start, command.startMinute);
        assert.ok(end > start);
        return [{ number: 'R26BK1', revision: '000', methodCode: '', title: '공고' }];
      });
      assert.equal(discoveries, 1);
      const state = await (await GET()).json();
      assert.equal(state.status, 'scheduled');
      assert.deepEqual(state.counts, { total: 1, pending: 0, running: 0, completed: 1, failed: 0 });
      const getList = (query) => list(new Request('http://localhost/?' + query));
      assert.equal((await getList('kind=all&cursor=invalid')).status, 400);
      assert.equal((await getList('kind=unknown')).status, 400);
      assert.deepEqual((await (await getList('kind=failed')).json()).items, []);
      const page = await (await getList('kind=all')).json();
      assert.equal(page.round.walkId, state.round.walkId);
      assert.equal(page.items[0].number, 'R26BK1');
      const numbered = await (await getList('kind=all&page=1')).json();
      assert.deepEqual([numbered.page, numbered.totalPages, numbered.items], [1, 1, page.items]);
      assert.equal(await getG2bRepository().noticeQueue.getRun(), undefined);
      assert.equal((await patch({ action: 'stop' })).status, 200);
      assert.equal((await (await GET()).json()).nextAt, null);
      getG2bDatabase().client.close();
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});
// 파일 libSQL의 Windows 커밋 잠금과 분리해, 같은 마이그레이션과 저장소 SQL의 쓰기 경합을 검증한다.
function openConcurrentSqlite(path) {
  const { DatabaseSync } = require('node:sqlite');
  const connection = new DatabaseSync(path);
  const execute = async (query) => {
    const { sql, args = [] } = typeof query === 'string' ? { sql: query } : query;
    const statement = connection.prepare(sql);
    if (statement.columns().length) return { rows: statement.all(...args) };
    const { changes, lastInsertRowid } = statement.run(...args);
    return { rows: [], rowsAffected: changes, lastInsertRowid };
  };
  return {
    protocol: 'file',
    execute,
    async transaction(mode) {
      connection.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN');
      return {
        execute,
        async executeMultiple(sql) { connection.exec(sql); },
        async commit() { connection.exec('COMMIT'); },
        close() { if (connection.isTransaction) connection.exec('ROLLBACK'); },
      };
    },
    close() { connection.close(); },
  };
}

test('자동 집계는 중복 접수, 동시 요청, 롤백과 회차 이동 후에도 원본 작업과 일치한다', async () => {
  const { mkdtemp, rm } = require('node:fs/promises');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  const folder = await mkdtemp(join(tmpdir(), 'g2b-automatic-'));
  const client = openConcurrentSqlite(join(folder, 'queue.db'));
  const second = openConcurrentSqlite(join(folder, 'queue.db'));
  const db = new G2bDatabase(client);
  const queue = openNoticeQueue(db);
  const other = openNoticeQueue(new G2bDatabase(second));
  const period = { startMinute: '2026-11-11T23:30', endMinute: '2026-11-11T23:59' };
  const target = (n) => ({ number: 'R26BK' + n, revision: '000', methodCode: '', title: String(n) });
  async function check(expected) {
    const [pending, running, completed, failed] = expected;
    const counts = { pending, running, completed, failed, total: expected.reduce((sum, n) => sum + n, 0) };
    assert.deepEqual((await queue.automatic.get()).counts, counts);
    const { rows } = await client.execute(`
      SELECT j.status, COUNT(*) AS count FROM g2b_notice_jobs j
      WHERE EXISTS (
        SELECT 1 FROM g2b_notice_walk_visits v JOIN g2b_notice_runs r ON r.walkId = v.walk_id
        WHERE v.job_id = j.id AND r.source = 'automatic'
          AND (j.status IN ('pending', 'retry_wait', 'running') OR r.walkId = (
            SELECT MAX(walkId) FROM g2b_notice_runs WHERE source = 'automatic'))
      ) GROUP BY j.status
    `);
    const raw = Object.fromEntries(rows.map(({status, count}) => [status, count]));
    assert.deepEqual([(raw.pending ?? 0) + (raw.retry_wait ?? 0), raw.running ?? 0,
      raw.succeeded ?? 0, raw.failed ?? 0], expected);
  }
  async function both(first, second) {
    // 첫 연결의 쓰기 잠금이 살아 있을 때 두 번째 요청을 보내고, 잠금 해제 후 같은 요청을 다시 보낸다.
    const firstResult = await db.transaction(async () => {
      await assert.rejects(second(), { errcode: 5 });
      return first();
    });
    return [firstResult, await second()];
  }
  try {
    await migrateG2bDatabase(client);
    const run = await queue.enqueueRun(period, undefined, 'automatic');
    await queue.claimRun();
    const targets = { kind: 'targets', targets: [target(1), target(1), target(2)] };
    await both(() => queue.finishRun(run, targets), () => other.finishRun(run, targets));
    await check([2, 0, 0, 0]);
    const additional = await queue.enqueueRun(period, undefined, 'automatic');
    await queue.claimRun();
    await queue.finishRun(additional, { kind: 'failure', error: '탐색 실패' });
    await check([2, 0, 0, 0]);
    await queue.enqueue([target(1)], true);
    await check([2, 0, 0, 0]);
    const [job, duplicate] = await both(() => queue.claim(0), () => other.claim(0));
    assert.ok(job);
    assert.equal(duplicate, undefined);
    await check([1, 1, 0, 0]);
    const reads = [];
    const prepareCurrent = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (sql.includes('INDEXED BY g2b_notice_jobs_running')) reads.push(sql);
      return prepareCurrent(sql);
    };
    assert.deepEqual({ ...(await queue.automatic.get()).currentNotice }, {
      number: target(1).number, revision: '000', title: target(1).title,
    });
    db.prepare = prepareCurrent;
    assert.equal(reads.length, 1);
    const currentPlan = await client.execute('EXPLAIN QUERY PLAN ' + reads[0]);
    assert.match(currentPlan.rows[0].detail, /SEARCH .* USING INDEX g2b_notice_jobs_running/);
    const success = { kind: 'success', related: [], result: {} };
    await assert.rejects(db.transaction(async () => {
      await queue.finish(job.id, success, 0);
      throw new Error('rollback');
    }), /rollback/);
    await check([1, 1, 0, 0]);
    await both(() => queue.finish(job.id, success, 0), () => other.finish(job.id, success, 0));
    await check([1, 0, 1, 0]);
    assert.equal((await queue.automatic.get()).currentNotice, null);
    await queue.finish((await queue.claim(0)).id, { kind: 'failure', error: '일시 오류' }, 0);
    await check([1, 0, 1, 0]);
    const later = await queue.enqueueRun(period, undefined, 'automatic');
    await queue.claimRun();
    await queue.finishRun(later, { kind: 'targets', targets: [] });
    await check([1, 0, 0, 0]);
    assert.equal((await queue.automatic.list('all')).items[0].number, target(2).number);
    assert.deepEqual((await queue.automatic.list('failed')).items, []);
    // 서로 다른 작업이 같은 완료 집계 행에 쓰는 경우에도 두 증가분이 남는다.
    const last = await queue.enqueueRun(period, undefined, 'automatic');
    await queue.claimRun();
    await queue.finishRun(last, { kind: 'targets', targets: [target(3), target(4)] });
    await check([3, 0, 0, 0]);
    const complete = (connection, n) => connection.execute({
      sql: "UPDATE g2b_notice_jobs SET status = 'succeeded' WHERE number = ? AND status = 'pending'",
      args: [target(n).number],
    });
    await both(
      () => complete(client, 3),
      () => complete(second, 4),
    );
    await check([1, 0, 2, 0]);
    const manual = await queue.enqueueRun(period);
    await queue.claimRun('manual');
    const manualTargets = { kind: 'targets', targets: [target(5), target(5)] };
    await both(() => queue.finishRun(manual, manualTargets), () => other.finishRun(manual, manualTargets));
    const [manualJob] = await both(() => queue.claim(0, 'manual'), () => other.claim(0, 'manual'));
    const failure = { kind: 'internal_error', error: '상세 실패' };
    await both(() => queue.finish(manualJob.id, failure, 0), () => other.finish(manualJob.id, failure, 0));
    const { notices, ...rawSummary } = await queue.getRun(manual);
    assert.equal(notices.length, 1);
    assert.deepEqual(await queue.getRunSummary(manual), rawSummary);
    assert.equal(rawSummary.failedCount, 1);
  } finally {
    second.close();
    client.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('자동 목록은 대량 이력에서도 인덱스 범위로 읽고 집계와 커서를 유지한다', async () => {
  const db = await testDatabase();
  const queue = openNoticeQueue(db);
  const period = { startMinute: '2026-11-12T10:00', endMinute: '2026-11-12T10:59' };
  const target = (n) => ({ number: 'R26BK' + n, revision: '000', methodCode: '', title: String(n) });
  try {
    await db.client.execute(`
      WITH RECURSIVE ids(n) AS (VALUES (1) UNION ALL SELECT n + 1 FROM ids WHERE n < 5000)
      INSERT INTO g2b_notice_jobs (number, revision, input, force, status)
      SELECT 'manual-' || n, '000', '{}', 0, 'succeeded' FROM ids
    `);
    const id = await queue.enqueueRun(period, undefined, 'automatic');
    await queue.claimRun();
    await queue.finishRun(id, { kind: 'targets', targets: Array.from({ length: 50 }, (_, n) => target(n)) });
    await db.client.execute(`UPDATE g2b_notice_jobs SET status = CASE WHEN id % 2 = 0 THEN 'failed' ELSE 'succeeded' END,
      error = '수집 오류' WHERE automaticWalkId IS NOT NULL AND id <= 5048`);

    // 운영에 남아 있는 버전 5 데이터에서 소속과 집계가 복원되고 재실행해도 중복되지 않아야 한다.
    await db.client.executeMultiple(`
      DROP TRIGGER g2b_notice_automatic_count_insert;
      DROP TRIGGER g2b_notice_automatic_count_delete;
      DROP TRIGGER g2b_notice_automatic_count_update;
      DROP TRIGGER g2b_notice_automatic_membership;
      DROP TABLE g2b_notice_automatic_counts;
      DROP INDEX g2b_notice_auto_latest_walk;
      DROP INDEX g2b_notice_auto_active;
      DROP INDEX g2b_notice_auto_terminal;
      DROP INDEX g2b_notice_auto_failed;
      DROP INDEX g2b_notice_auto_queue_state;
      DROP INDEX g2b_notice_auto_unfinished_runs;
      ALTER TABLE g2b_notice_jobs DROP COLUMN automaticWalkId;
      DELETE FROM g2b_schema_migrations WHERE version = 6;
    `);
    const oldPlan = await db.client.execute("EXPLAIN QUERY PLAN SELECT walkId FROM g2b_notice_runs WHERE source = 'automatic' AND walkId IS NOT NULL ORDER BY walkId DESC LIMIT 1");
    assert.ok(oldPlan.rows.some(({ detail }) => detail.includes('USE TEMP B-TREE')));
    await migrateG2bDatabase(db.client);
    await migrateG2bDatabase(db.client);
    await db.client.execute('ANALYZE');
    const totalChanges = async () => (await db.client.execute('SELECT total_changes() AS count')).rows[0].count;
    const originalChanges = await totalChanges();
    await db.client.execute("UPDATE g2b_notice_jobs SET status = 'retry_wait' WHERE id = 5050");
    assert.equal((await totalChanges()) - originalChanges, 1);
    const beforeRunning = await totalChanges();
    await db.client.execute("UPDATE g2b_notice_jobs SET status = 'running' WHERE id = 5050");
    assert.equal((await totalChanges()) - beforeRunning, 3);
    await db.client.execute("UPDATE g2b_notice_jobs SET status = 'pending' WHERE id = 5050");

    const queries = [];
    const prepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const statement = prepare(sql);
      return {
        ...statement,
        get: (...args) => { queries.push({ sql, args }); return statement.get(...args); },
        all: (...args) => { queries.push({ sql, args }); return statement.all(...args); },
      };
    };
    const settings = await queue.automatic.get();
    assert.deepEqual(settings.counts, { total: 50, pending: 2, running: 0, completed: 24, failed: 24 });
    const first = await queue.automatic.list('all');
    assert.equal(first.items.length, 20);
    assert.equal(first.previous, null);
    const second = await queue.automatic.list('all', first.next);
    assert.equal(second.items.length, 20);
    assert.ok(second.items[0].id < first.items.at(-1).id);
    const back = await queue.automatic.list('all', second.previous);
    assert.deepEqual(back.items, first.items);
    assert.equal(back.resetCursor, true);
    const failed = await queue.automatic.list('failed');
    assert.equal(failed.items.length, 20);
    assert.ok(failed.items.every((item) => item.status === 'failed' && item.error === '수집 오류'));
    const finalFailures = await queue.automatic.list('failed', failed.next);
    assert.equal(finalFailures.items.length, 4);
    assert.equal(finalFailures.next, null);
    assert.deepEqual((await queue.automatic.list('all', { ...first.next, walkId: 99 })).items, first.items);
    const numbered = await queue.automatic.numberNotices('all', 2);
    assert.deepEqual([numbered.page, numbered.totalPages, numbered.items], [2, 3, second.items]);
    const last = await queue.automatic.numberNotices('all', 99);
    assert.deepEqual([last.page, last.totalPages, last.items.length], [3, 3, 10]);
    assert.equal((await queue.automatic.numberNotices('all', 2, 99)).page, 1);
    assert.equal((await queue.automatic.numberNotices('failed', 2)).items.length, 4);

    // 통계상 대기 공고가 대다수지만 가장 최근에는 종료 공고만 몰린 분포도 검증한다.
    await db.client.execute("UPDATE g2b_notice_jobs SET automaticWalkId = 1, status = 'pending' WHERE id <= 5000");
    await db.client.execute('ANALYZE');
    const listPlans = [];
    for (const { sql, args } of queries) {
      const { rows } = await db.client.execute({ sql: 'EXPLAIN QUERY PLAN ' + sql, args });
      const plan = rows.map(({ detail }) => detail).join('\n');
      // 번호 조회의 마지막 정렬은 선택된 최대 20건에만 적용한다.
      assert.doesNotMatch(plan, /SCAN g2b_notice_automatic_counts/);
      if (!sql.includes('WITH selected AS MATERIALIZED')) assert.doesNotMatch(plan, /USE TEMP B-TREE/);
      else {
        if (sql.includes('UNION ALL')) assert.match(plan, /MERGE \(UNION ALL\)/);
        assert.ok((plan.match(/USE TEMP B-TREE/g) ?? []).length <= 1, plan);
      }
      if (sql.includes(' AS pending')) assert.match(plan, /SEARCH g2b_notice_runs USING INDEX g2b_notice_auto_unfinished_runs/);
      if (sql.includes('LIMIT 21')) listPlans.push(plan);
    }
    assert.ok(listPlans.length >= 8);
    assert.ok(listPlans.every((plan) => /USING INDEX g2b_notice_auto_(active|terminal|failed)/.test(plan)), listPlans.join('\n'));
  } finally {
    db.client.close();
  }
});
test('기간 요약과 실패 페이지는 원본 공고 상태를 반영하고 등록 순서를 유지한다', async () => {
  const db = await testDatabase();
  const queue = openNoticeQueue(db);
  try {
    const period = { startMinute: '2026-11-12T10:00', endMinute: '2026-11-12T10:59' };
    const id = await queue.enqueueRun(period);
    await queue.claimRun();
    await queue.finishRun(id, { kind: 'targets', targets: Array.from({ length: 45 }, (_, n) => ({
      number: 'PERIOD' + n, revision: '000', methodCode: '', title: String(n),
    })) });
    assert.equal((await queue.getRunSummary(id)).totalCount, 45);
    await db.client.execute("UPDATE g2b_notice_jobs SET status = 'failed' WHERE id <= 22");
    // 버전 6의 방문 기록에서도 같은 요약과 실패 순서를 복원한다.
    await db.client.executeMultiple(`
      DROP TRIGGER g2b_notice_period_run;
      DROP TRIGGER g2b_notice_period_visit;
      DROP TRIGGER g2b_notice_period_job_status;
      DROP TRIGGER g2b_notice_period_count;
      DROP INDEX g2b_notice_manual_runs;
      DROP INDEX g2b_notice_manual_run_walk;
      DROP INDEX g2b_notice_period_visits;
      DROP INDEX g2b_notice_period_failed;
      DROP INDEX g2b_notice_period_job;
      DROP TABLE g2b_notice_period_counts;
      ALTER TABLE g2b_notice_walk_visits DROP COLUMN periodStatus;
      DELETE FROM g2b_schema_migrations WHERE version = 7;
    `);
    await migrateG2bDatabase(db.client);
    await migrateG2bDatabase(db.client);
    const statements = [];
    const prepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const statement = prepare(sql);
      return {
        ...statement,
        all: (...args) => { statements.push({ sql, args }); return statement.all(...args); },
        get: (...args) => { if (sql.includes('period_counts')) statements.push({ sql, args }); return statement.get(...args); },
      };
    };
    const first = await queue.listRunNotices(id, 'failed');
    assert.equal(first.items.length, 20);
    assert.equal(first.items[0].number, 'PERIOD0');
    const second = await queue.listRunNotices(id, 'failed', first.next);
    assert.equal(second.items.length, 2);
    assert.deepEqual((await queue.listRunNotices(id, 'failed', second.previous)).items, first.items);
    assert.equal((await queue.listRunNotices(id, 'all')).items.length, 20);
    const numbered = await queue.numberRunNotices(id, 'failed', 2);
    assert.deepEqual(numbered.items, second.items);
    assert.equal(numbered.totalPages, 2);
    const last = await queue.numberRunNotices(id, 'all', 99);
    assert.deepEqual([last.page, last.totalPages, last.items.length, last.items[0].number], [3, 3, 5, 'PERIOD40']);
    assert.equal((await queue.getRunSummary(id)).failedCount, 22);
    for (const { sql, args } of statements.splice(0)) {
      const { rows } = await db.client.execute({ sql: 'EXPLAIN QUERY PLAN ' + sql, args });
      const plan = rows.map(({ detail }) => detail).join('\n');
      assert.doesNotMatch(plan, /SCAN [vc]\b/);
      if (!sql.includes('WITH selected AS MATERIALIZED')) assert.doesNotMatch(plan, /USE TEMP B-TREE/);
      if (sql.includes('LIMIT 21')) assert.match(plan, /USING INDEX g2b_notice_period_(visits|failed)/);
      else if (sql.includes('WITH selected AS MATERIALIZED')) assert.match(plan, /USING (?:COVERING )?INDEX g2b_notice_period_(visits|failed)/);
      else assert.match(plan, /SEARCH c USING INTEGER PRIMARY KEY/);
    }
    await assert.rejects(db.transaction(async () => {
      await db.prepare("UPDATE g2b_notice_jobs SET status = 'succeeded' WHERE id = 1").run();
      throw Error('rollback');
    }), /rollback/);
    assert.equal((await queue.getRunSummary(id)).failedCount, 22);
    await db.client.execute("UPDATE g2b_notice_jobs SET status = 'succeeded'");
    const summary = await queue.getRunSummary(id);
    assert.deepEqual([summary.status, summary.totalCount, summary.succeededCount, summary.failedCount],
      ['completed', 45, 45, 0]);
    assert.deepEqual((await queue.listRunNotices(id, 'failed', first.next)).items, []);
  } finally { db.client.close(); }
});
