require('../scripts/register-project-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { getG2bDatabase } = require('../src/server/g2b/repository');
const { migrateG2bDatabase } = require('../src/server/g2b/repository/migrations');
const { openAttachmentDispatch } = require('../src/server/g2b/repository/attachment-dispatch');
const { POST } = require('../app/api/g2b/attachment-queue/tick/route');

test('복구 호출은 실행 가능 이벤트만 예약하고 중복 호출과 GitHub 실패를 처리한다', async (t) => {
  process.env.TURSO_DATABASE_URL = ':memory:';
  process.env.TURSO_AUTH_TOKEN = 'test';
  process.env.ATTACHMENT_WORKER_MODE = 'github-actions';
  process.env.NOTICE_CRON_TOKEN = 'test-cron';
  process.env.NOTICE_GITHUB_REPOSITORY = 'example/project';
  process.env.NOTICE_GITHUB_REF = 'main';
  process.env.NOTICE_GITHUB_TOKEN = 'test-actions';
  const db = getG2bDatabase();
  const request = (token = 'test-cron') => new Request('http://localhost', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token },
  });
  const queries = [];
  const prepare = db.prepare.bind(db);
  t.mock.method(db, 'prepare', (sql) => {
    queries.push(sql);
    return prepare(sql);
  });
  let fail = true;
  const fetcher = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: fail ? 503 : 204 }));
  try {
    await migrateG2bDatabase(db.client);
    assert.equal((await POST(request('wrong'))).status, 401);
    assert.equal((await POST(request())).status, 204);
    await db.client.execute(`INSERT INTO g2b_attachment_events(section,number,revision,completion_id,available_at)
      VALUES ('notices','A','000',1,unixepoch() + 60)`);
    assert.equal((await POST(request())).status, 204);
    assert.equal(fetcher.mock.callCount(), 0);
    await db.client.execute('UPDATE g2b_attachment_events SET available_at = 0');
    assert.equal((await POST(request())).status, 503);
    fail = false;
    const outcomes = await Promise.all([POST(request()), POST(request()), POST(request())]);
    assert.deepEqual(outcomes.map(({ status }) => status).sort(), [202, 204, 204]);
    assert.equal(fetcher.mock.callCount(), 2);
    assert.equal((await POST(request())).status, 204);

    const query = queries.find((sql) => sql.startsWith('SELECT 1 FROM g2b_attachment_dispatch'));
    const plan = await db.client.execute('EXPLAIN QUERY PLAN ' + query);
    for (const index of ['g2b_attachment_events_ready', 'g2b_attachment_ready', 'g2b_attachment_retry', 'g2b_attachment_leases']) {
      assert.ok(plan.rows.some(({ detail }) => detail.includes(index)), index);
    }
    await db.client.execute('UPDATE g2b_attachment_dispatch SET expires_at = 0');
    const reservation = openAttachmentDispatch(db);
    const old = await reservation.reserve();
    await db.client.execute('UPDATE g2b_attachment_dispatch SET expires_at = 0');
    const current = await reservation.reserve();
    await reservation.finish(old, false);
    assert.equal((await db.client.execute('SELECT token FROM g2b_attachment_dispatch')).rows[0].token, current);
  } finally {
    db.client.close();
  }
});
