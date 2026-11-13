require('../scripts/register-project-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { openNoticeQueue } = require('../src/server/g2b/repository/notice-queue.ts');

test('기간 실행은 최초 건수를 고정하고 재시도와 연관 공고를 같은 실행으로 집계한다', () => {
  const db = new DatabaseSync(':memory:');
  const queue = openNoticeQueue(db);
  const period = { startMinute: '2026-11-11T23:30', endMinute: '2026-11-11T23:59' };
  const initial = { number: 'R26BK1', revision: '000', methodCode: '', title: '초기 공고' };
  const related = { ...initial, revision: '001', title: '' };
  const id = queue.enqueueRun(period, 'request-a');
  assert.equal(queue.enqueueRun(period, 'request-a'), id);
  assert.equal(queue.getRun(id).initialCount, null);
  assert.equal(queue.claimRun().id, id);
  queue.recover();
  assert.equal(queue.claimRun().id, id);
  queue.finishRun(id, { kind: 'targets', targets: [initial, initial] });
  assert.equal(queue.getRun().initialCount, 1);
  const parent = queue.claim(0);
  queue.finish(parent.id, { kind: 'failure', error: '일시 오류', related: [related] }, 0);
  assert.equal(queue.getRun(id).totalCount, 2);
  assert.equal(queue.getRun(id).failedCount, 0);
  const child = queue.claim(0);
  queue.finish(child.id, { kind: 'success', related: [initial], result: { title: '연관 공고' } }, 0);
  assert.equal(queue.getRun(id).notices[1].title, '연관 공고');
  for (const now of [60000, 120000]) {
    assert.equal(queue.claim(now).id, parent.id);
    queue.finish(parent.id, { kind: 'failure', error: '실패' }, now);
  }
  const done = queue.getRun(id);
  assert.deepEqual([done.status, done.initialCount, done.totalCount, done.succeededCount, done.failedCount],
    ['completed', 1, 2, 1, 1]);
  db.close();
});

test('목록 실패, 점검 대기, 정상 0건 및 등록 롤백을 구분한다', () => {
  const db = new DatabaseSync(':memory:');
  const queue = openNoticeQueue(db);
  const period = { startMinute: '2026-11-11T23:30', endMinute: '2026-11-11T23:59' };
  const id = queue.enqueueRun(period);
  queue.claimRun();
  queue.finishRun(id, { kind: 'maintenance', error: '점검' });
  assert.equal(queue.getRun(id).pauseReason, 'maintenance');
  assert.equal(queue.claimRun(), undefined);
  queue.clearMaintenance(queue.maintenanceVersion());
  queue.claimRun();
  db.exec("CREATE TRIGGER fail_visit BEFORE INSERT ON g2b_notice_walk_visits BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.throws(() => queue.finishRun(id, { kind: 'targets', targets: [
    { number: 'R26BK1', revision: '000', methodCode: '', title: '공고' },
  ] }));
  assert.equal(queue.getRun(id).initialCount, null);
  assert.equal(queue.overview().jobs.length, 0);
  queue.finishRun(id, { kind: 'failure', error: '목록 오류' });
  assert.equal(queue.getRun(id).status, 'failed');
  assert.equal(queue.getRun(id).failedCount, 0);
  const emptyId = queue.enqueueRun(period);
  queue.claimRun();
  queue.finishRun(emptyId, { kind: 'targets', targets: [] });
  assert.equal(queue.getRun(emptyId).status, 'completed');
  assert.equal(queue.getRun(emptyId).initialCount, 0);
  db.close();
});

test('기간 수집 API 접수 후 워커가 초기 공고와 연관 공고를 자동 처리한다', () => {
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
      const period = { startMinute: '2026-11-11T23:30', endMinute: '2026-11-11T23:59' };
      const post = (body) => POST(new Request('http://localhost', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'period-1' },
        body: JSON.stringify(body),
      }));
      assert.equal((await POST(new Request('http://localhost', {
        method: 'POST', body: JSON.stringify(period),
      }))).status, 415);
      assert.equal((await post({ ...period, endMinute: '2026-02-30T10:00' })).status, 400);
      assert.equal(await GET().json(), null);
      const accepted = await post(period);
      assert.equal(accepted.status, 202);
      const { id } = await accepted.json();
      assert.equal(accepted.headers.get('Location'), '/api/g2b/notice-collection-runs/' + id);
      assert.equal((await (await post(period)).json()).id, id);
      assert.equal((await post({ ...period, endMinute: '2026-11-12T00:00' })).status, 409);
      assert.equal((await GET().json()).status, 'pending');
      assert.equal((await byId(null, { params: Promise.resolve({ id: '999' }) })).status, 404);

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
      const run = await (await byId(null, { params: Promise.resolve({ id: String(id) }) })).json();
      assert.deepEqual([run.status, run.initialCount, run.totalCount, run.succeededCount, run.failedCount],
        ['completed', 1, 2, 1, 1]);
      assert.equal(run.notices[1].error, '상세 실패');
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', code], { cwd: dir, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('실패 지연, 강제 승격, 중단 복구와 완료 후속 등록', () => {
  const db = new DatabaseSync(':memory:');
  const queue = openNoticeQueue(db);
  const key = { number: 'R26BK00000001', revision: '000', methodCode: '' };
  const related = { ...key, revision: '001' };
  const id = queue.enqueue([key], false)[0];
  assert.equal(queue.claim(10).id, id);
  queue.finish(id, { kind: 'failure', error: '조회 실패' }, 10);
  assert.equal(queue.claim(60009), undefined);
  assert.equal(queue.enqueue([key], true)[0], id);
  assert.equal(queue.claim(Date.now()).failures, 0);
  queue.recover();
  assert.equal(queue.claim(Date.now()).id, id);
  queue.finish(id, { kind: 'success', related: [related], result: {} }, 10);
  const child = queue.claim(Date.now());
  assert.equal(child.input.revision, '001');
  queue.finish(child.id, { kind: 'success', related: [key], result: {} }, 10);
  assert.equal(queue.claim(Date.now()), undefined);
  db.close();
});

test('수동 중단과 점검을 따로 해제하고 일반 실패 세 번째에 종료한다', () => {
  const db = new DatabaseSync(':memory:');
  const queue = openNoticeQueue(db);
  const key = { number: 'R26BK00000002', revision: '000', methodCode: '' };
  const id = queue.enqueue([key], false)[0];
  queue.setManual(true);
  queue.markMaintenance();
  const version = queue.maintenanceVersion();
  queue.markMaintenance();
  queue.clearMaintenance(version);
  queue.setManual(false);
  assert.equal(queue.claim(0), undefined);
  queue.clearMaintenance(queue.maintenanceVersion());
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = attempt * 60_000;
    assert.equal(queue.claim(now).id, id);
    queue.finish(id, { kind: 'failure', error: '조회 실패' }, now);
  }
  assert.equal(queue.get(id).status, 'failed');
  assert.equal(queue.get(id).failures, 3);
  queue.recover();
  assert.equal(queue.claim(180_000), undefined);
  db.close();
});

test('두 프로세스에서 워커 잠금을 동시에 가질 수 없고 강제 종료 후 재획득한다', async (t) => {
  const { spawn, spawnSync } = require('node:child_process');
  const { once } = require('node:events');
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'notice-worker-lock-'));
  const loader = require.resolve('../scripts/register-project-typescript.cjs');
  const lock = require.resolve('../src/server/g2b/repository/notice-worker-lock.ts');
  const code = `require(${JSON.stringify(loader)});
    const release = require(${JSON.stringify(lock)}).acquireNoticeWorkerLock(process.argv[1]);
    if (process.argv[2]) { console.log('locked'); setInterval(() => {}, 1000); }
    else release();`;
  const first = spawn(process.execPath, ['-e', code, dir, 'hold']);
  try {
    const [data] = await Promise.race([
      once(first.stdout, 'data'),
      once(first, 'exit').then(([status]) => { throw new Error('lock process exited ' + status); }),
    ]);
    assert.match(String(data), /locked/);
    const blocked = spawnSync(process.execPath, ['-e', code, dir], { encoding: 'utf8' });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /database is locked/);
    const exited = once(first, 'exit');
    first.kill('SIGKILL');
    await exited;
    assert.equal(spawnSync(process.execPath, ['-e', code, dir]).status, 0);
  } finally {
    if (first.exitCode === null && first.signalCode === null) {
      const exited = once(first, 'exit');
      first.kill('SIGKILL');
      await exited;
    }
    rmSync(dir, { recursive: true, force: true });
  }
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
    const { noticeQueue: queue, collectionAttempts } = require(${JSON.stringify(repository)}).getG2bRepository();
    const { trackCollectionAttempt } = require(${JSON.stringify(tracker)});
    const stop = new AbortController();
    const [id] = queue.enqueue([{ number: 'R26BK00000003', revision: '000', methodCode: '' }], true);
    const [nextId] = queue.enqueue([{ number: 'R26BK00000005', revision: '000', methodCode: '' }], true);
    const executions = [];
    let writes = 0;
    const execute = async (job) => {
      executions.push(job.id);
      if (job.id === id) {
        collectionAttempts.start({ section: 'notices', ...job.input }, id);
        throw new Error('injected execution error');
      }
      assert.equal(queue.get(id).status, 'failed');
      await trackCollectionAttempt({ section: 'notices', ...job.input }, async () => {});
      const pending = collectionAttempts.overview('notices').failures.find((attempt) => attempt.number === job.input.number);
      assert.equal(pending.status, 'pending');
      return { kind: 'success', related: [], result: { noticeSaved: true } };
    };
    const finish = queue.finish;
    queue.finish = (...args) => {
      if (++writes === 1) throw new Error('injected write error');
      finish(...args);
      if (args[0] === nextId) stop.abort();
    };
    require(${JSON.stringify(worker)}).runNoticeWorker(stop.signal, execute).then(() => {
      assert.deepEqual(executions, [id, nextId]);
      assert.equal(writes, 3);
      assert.equal(queue.get(id).status, 'failed');
      assert.equal(queue.get(id).failures, 0);
      assert.equal(queue.get(nextId).status, 'succeeded');
      assert.equal(collectionAttempts.overview('notices').failures.length, 1);
      assert.equal(collectionAttempts.overview('notices').failures[0].status, 'failed');
    }).catch((error) => { console.error(error); process.exitCode = 1; });
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

test('저장 직후 중단된 작업과 미종료 이력만 복구하고 일반 실패 횟수를 보존한다', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE g2b_collection_attempts (job_id INTEGER, status TEXT, finished_at TEXT, error TEXT);
    CREATE TABLE notices (number TEXT PRIMARY KEY);
  `);
  const queue = openNoticeQueue(db);
  const input = { number: 'R26BK00000004', revision: '000', methodCode: '' };
  const [id] = queue.enqueue([input], true);
  queue.claim(0);
  queue.finish(id, { kind: 'failure', error: 'API 오류' }, 0);
  const [waiting] = queue.enqueue([{ ...input, revision: '002' }], true);
  queue.claim(0);
  queue.finish(waiting, { kind: 'failure', error: 'API 오류' }, 30_000);
  db.prepare("INSERT INTO g2b_collection_attempts VALUES (?, 'pending', NULL, NULL)").run(waiting);
  db.exec("INSERT INTO g2b_collection_attempts VALUES (NULL, 'pending', NULL, NULL)");
  queue.claim(60_000);
  db.prepare("INSERT INTO g2b_collection_attempts VALUES (?, 'pending', NULL, NULL)").run(id);
  db.prepare("INSERT INTO notices VALUES (?)").run(input.number);
  queue.recover();
  assert.equal(queue.get(id).status, 'pending');
  assert.equal(queue.get(id).failures, 1);
  assert.equal(db.prepare('SELECT status FROM g2b_collection_attempts WHERE job_id = ?').get(id).status, 'deferred');
  assert.equal(db.prepare('SELECT status FROM g2b_collection_attempts WHERE job_id = ?').get(waiting).status, 'deferred');
  assert.equal(db.prepare('SELECT status FROM g2b_collection_attempts WHERE job_id IS NULL').get().status, 'pending');
  assert.equal(queue.get(waiting).status, 'retry_wait');
  assert.equal(queue.claim(60_000).id, id);
  db.prepare("INSERT OR IGNORE INTO notices VALUES (?)").run(input.number);
  queue.finish(id, { kind: 'success', related: [{ ...input, revision: '001' }], result: {} }, 60_000);
  queue.recover();
  assert.equal(queue.get(id).status, 'succeeded');
  assert.equal(queue.claim(60_000).input.revision, '001');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM notices').get().total, 1);
  db.close();
});

test('Attempt 종료와 후속 등록은 Job 상태와 함께 롤백되고 재시도에서 한 번만 반영된다', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE g2b_collection_attempts (
      id INTEGER PRIMARY KEY, job_id INTEGER, status TEXT, finished_at TEXT, error TEXT, diagnostics TEXT
    );
  `);
  const queue = openNoticeQueue(db);
  const input = { number: 'R26BK00000006', revision: '000', methodCode: '' };
  const [id] = queue.enqueue([input], true);
  queue.claim(0);
  db.prepare("INSERT INTO g2b_collection_attempts (id, job_id, status) VALUES (1, ?, 'pending'), (2, ?, 'pending')").run(id, id);
  const finishedAt = new Date(0).toISOString();
  const attempts = [
    { id: 1, status: 'failed', error: '원래 오류', diagnostics: { name: 'Error', message: '원래 진단' }, finishedAt },
    { id: 2, status: 'succeeded', error: null, finishedAt },
  ];
  const outcome = { kind: 'failure', error: '부분 실패', related: [{ ...input, revision: '001' }] };
  const read = () => db.prepare('SELECT status, diagnostics FROM g2b_collection_attempts ORDER BY id').all();
  for (const table of ['g2b_collection_attempts', 'g2b_notice_jobs']) {
    db.exec(`CREATE TRIGGER fail_write BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    assert.throws(() => queue.finish(id, outcome, 0, attempts), /injected/);
    assert.deepEqual(read().map((row) => row.status), ['pending', 'pending']);
    assert.equal(queue.get(id).status, 'running');
    assert.equal(queue.overview().jobs.length, 1);
    db.exec('DROP TRIGGER fail_write');
  }
  queue.finish(id, outcome, 0, attempts);
  queue.finish(id, outcome, 0, attempts);
  assert.deepEqual(read().map((row) => row.status), ['failed', 'succeeded']);
  assert.deepEqual(JSON.parse(read()[0].diagnostics), attempts[0].diagnostics);
  assert.equal(queue.get(id).status, 'retry_wait');
  assert.equal(queue.get(id).failures, 1);
  assert.equal(queue.overview().jobs.length, 2);
  db.close();
});
