require('../scripts/register-project-typescript.cjs');
require("./mock-business-session.cjs").mockBusinessSession();
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { G2bDatabase } = require('../src/server/g2b/repository/database');
const { migrateG2bDatabase } = require('../src/server/g2b/repository/migrations');
const { openAttachmentQueue } = require('../src/server/g2b/repository/attachment-queue');
const { listAttachmentJobs, preferredPdfFiles } = require('../src/features/download-g2b-attachment/server/attachment-catalog');
const { hashAttachmentBody } = require('../src/features/download-g2b-attachment/server/attachment-worker');
const { pdfExtractor } = require('../src/shared/model/g2b/attachment-extraction');

test('format registry normalizes encoded extensions and keeps unsupported files hash-only', () => {
  const { findAttachmentExtractor } = require('../src/shared/model/g2b/attachment-extraction');
  assert.equal(findAttachmentExtractor('규격&#46;PDF').format, 'pdf');
  assert.equal(findAttachmentExtractor('규격.hwp').entrypoint, findAttachmentExtractor('규격.pdf').entrypoint);
  assert.equal(findAttachmentExtractor('규격.zip'), undefined);
});

test('마이그레이션 14는 배포 전 모든 PDF 상태에서 해시 처리 모드를 유지한다', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    await client.executeMultiple(`
      ALTER TABLE g2b_attachment_jobs DROP COLUMN result_id;
      DROP TABLE g2b_attachment_result_units;
      DROP TABLE g2b_attachment_results;
      DELETE FROM g2b_schema_migrations WHERE version = 17;
      ALTER TABLE g2b_attachment_jobs DROP COLUMN pdf_result_id;
      ALTER TABLE g2b_attachment_jobs DROP COLUMN mode;
      DROP TABLE g2b_attachment_pdf_pages;
      DROP TABLE g2b_attachment_pdf_results;
      DELETE FROM g2b_schema_migrations WHERE version = 14;
      INSERT INTO g2b_attachment_jobs(id,file,priority,status) VALUES
        ('a','{"filename":"a.pdf"}',0,'pending'),
        ('b','{"filename":"b.pdf"}',1,'running'),
        ('c','{"filename":"c.pdf"}',0,'retry_wait'),
        ('d','{"filename":"d.pdf"}',1,'succeeded');
    `);
    await migrateG2bDatabase(client);
    const { rows } = await client.execute('SELECT status, mode, pdf_result_id FROM g2b_attachment_jobs ORDER BY id');
    assert.deepEqual(rows.map((row) => row.status), ['pending', 'running', 'retry_wait', 'succeeded']);
    assert.ok(rows.every((row) => row.mode === 'hash_only' && row.pdf_result_id === null));
  } finally {
    client.close();
  }
});

test('v17 preserves v16 PDF result IDs, text, and job scheduling state', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    await client.executeMultiple("ALTER TABLE g2b_attachment_jobs DROP COLUMN result_id;" +
      "DROP TABLE g2b_attachment_result_units; DROP TABLE g2b_attachment_results;" +
      "DELETE FROM g2b_schema_migrations WHERE version = 17;" +
      "INSERT INTO g2b_attachment_pdf_results VALUES (42,'old','v1',2,3);" +
      "INSERT INTO g2b_attachment_pdf_pages VALUES (42,1,'abc'),(42,2,'');" +
      "INSERT INTO g2b_attachment_jobs(id,file,priority,status,available_at,attempts,hash,mode,pdf_result_id) VALUES" +
      " ('done','{}',1,'succeeded',0,2,'old','pdf_extract',42)," +
      " ('pending','{}',0,'pending',0,0,NULL,'pdf_extract',NULL)," +
      " ('retry','{}',1,'retry_wait',1234,3,NULL,'pdf_extract',NULL);");
    await migrateG2bDatabase(client);
    await migrateG2bDatabase(client);
    const { rows } = await client.execute('SELECT id, mode, status, priority, available_at, attempts, result_id FROM g2b_attachment_jobs ORDER BY id');
    assert.deepEqual(rows.map(Object.values), [
      ['done', 'extract', 'succeeded', 1, 0, 2, 42],
      ['pending', 'extract', 'pending', 0, 0, 0, null],
      ['retry', 'extract', 'retry_wait', 1, 1234, 3, null],
    ]);
    const db = new G2bDatabase(client);
    const { readAttachmentResultUnit } = require('../src/server/g2b/repository/attachment-results');
    assert.deepEqual(await readAttachmentResultUnit(db, 42, 1), { unitNumber: 1, text: 'abc' });
    assert.deepEqual(await readAttachmentResultUnit(db, 42, 2), { unitNumber: 2, text: '' });
    const queue = openAttachmentQueue(db);
    assert.equal(await queue.hasExtraction('old', { format: 'pdf', version: 'v1' }), true);
    assert.equal(await queue.hasExtraction('old', { format: 'hwpx', version: 'v1' }), false);
    assert.equal(await queue.hasExtraction('old', { format: 'pdf', version: 'v2' }), false);
  } finally {
    client.close();
  }
});

test('기존 PDF는 자동 인계에서 처리 모드를 보존하고 실행 중 수동 요청은 완료 후 이어진다', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    const queue = openAttachmentQueue(new G2bDatabase(client), undefined, () => pdfExtractor);
    const old = { id: 'old', filename: 'old.pdf' };
    const fresh = { id: 'fresh', filename: 'fresh.PDF' };
    await client.execute({ sql: 'INSERT INTO g2b_attachment_jobs(id,file,priority) VALUES (?,?,0)', args: [old.id, JSON.stringify(old)] });
    await client.execute("INSERT INTO g2b_attachment_events(section,number,revision,completion_id) VALUES ('notices','A','000',1)");
    await queue.consume(await queue.event(), [old, fresh]);
    const legacy = await queue.claim();
    assert.equal(legacy.mode, 'hash_only');
    assert.equal((await queue.enqueue(old, true)).shouldDispatch, false);
    assert.equal((await queue.status(old.id)).status, 'running');
    assert.equal(await queue.finish(legacy, { hash: 'same' }), true);
    const manual = await queue.claim();
    assert.equal(manual.file.id, old.id);
    assert.equal(manual.mode, 'extract');
    const stale = { ...manual, token: legacy.token };
    assert.equal(await queue.finish(stale, { hash: 'stale', extraction: { format: pdfExtractor.format,
      version: pdfExtractor.version, result: { units: ['미반영'] },
    } }), false);
    assert.equal(await queue.hasExtraction('stale', pdfExtractor), false);
    await queue.finish(manual, { hash: 'same', extraction: { format: pdfExtractor.format, version: pdfExtractor.version, result: { units: ['본문'] } } });
    const automatic = await queue.claim();
    assert.equal(automatic.mode, 'extract');
    assert.equal(await queue.hasExtraction('same', pdfExtractor), true);
    assert.equal(await queue.finish(automatic, { hash: 'same', extraction: { format: pdfExtractor.format, version: pdfExtractor.version } }), true);
    assert.equal((await queue.status(old.id)).resultId, (await queue.status(fresh.id)).resultId);
    assert.ok((await queue.status(old.id)).resultId);
    const legacyDone = { id: 'done', filename: 'done.pdf' };
    await client.execute({ sql: "INSERT INTO g2b_attachment_jobs(id,file,priority,status,hash) VALUES (?,?,0,'succeeded','same')",
      args: [legacyDone.id, JSON.stringify(legacyDone)] });
    const reused = await queue.enqueue(legacyDone, true);
    assert.equal(reused.job.resultId, (await queue.status(old.id)).resultId);
    assert.equal(reused.shouldDispatch, false);
    assert.equal(await queue.claim(), undefined);
    const lookup = await client.execute("EXPLAIN QUERY PLAN SELECT id FROM g2b_attachment_results WHERE hash = 'same' AND format = 'pdf' AND extractor_version = 'v1'");
    assert.match(lookup.rows[0].detail, /SEARCH .* USING COVERING INDEX/);
  } finally {
    client.close();
  }
});

test('첨부 완료 갱신이 실패하면 같은 트랜잭션에서 쓴 결과와 JSON을 롤백한다', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    const queue = openAttachmentQueue(new G2bDatabase(client));
    await queue.enqueue({ id: 'rollback', filename: 'rollback.pdf' }, true);
    const claim = await queue.claim();
    await client.executeMultiple(`
      CREATE TRIGGER fail_attachment_finish BEFORE UPDATE OF result_id ON g2b_attachment_jobs
      WHEN NEW.result_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'finish failed'); END;
    `);
    await assert.rejects(queue.finish(claim, { hash: 'new', extraction: {
      format: pdfExtractor.format, version: pdfExtractor.version, result: {
        document: { schemaVersion: 1, units: [{ blocks: [{ id: '1', kind: 'paragraph', text: '본문' }] }] },
      },
    } }), /finish failed/);
    assert.equal(await queue.hasExtraction('new', pdfExtractor), false);
    const { rows } = await client.execute('SELECT count(*) AS count FROM g2b_attachment_document_units');
    assert.equal(rows[0].count, 0);
    assert.equal((await queue.status('rollback')).status, 'running');
  } finally {
    client.close();
  }
});

test('수동 작업은 자동 작업보다 먼저 실행되고 만료된 실행권은 결과를 저장할 수 없다', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    const queue = openAttachmentQueue(new G2bDatabase(client));
    const file = { id: 'automatic', filename: 'a.zip' };
    await queue.enqueue(file, false);
    await queue.enqueue({ ...file, id: 'manual' }, false);
    assert.equal((await queue.enqueue({ ...file, id: 'manual' }, true)).shouldDispatch, true);
    assert.equal((await queue.enqueue({ ...file, id: 'manual' }, true)).shouldDispatch, false);
    const first = await queue.claim();
    assert.equal(first.file.id, 'manual');
    assert.equal(await queue.renew(first), true);
    await client.execute("UPDATE g2b_attachment_jobs SET expires_at = 0 WHERE id = 'manual'");
    const next = await queue.claim();
    assert.equal(next.file.id, 'manual');
    assert.equal(await queue.finish(first, { hash: 'stale' }), false);
    assert.equal(await queue.finish(next, { hash: 'current' }), true);
    assert.equal((await queue.claim()).file.id, 'automatic');
  } finally {
    client.close();
  }
});

test('수집 성공 이벤트를 남기고 재시작 뒤에도 첨부를 한 번만 등록한다', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    const queue = openAttachmentQueue(new G2bDatabase(client));
    await client.executeMultiple(`
      INSERT INTO g2b_notice_jobs(number,revision,input,force,status) VALUES ('n','001','{}',0,'running');
      INSERT INTO g2b_collection_attempts(section,number,revision,opening_revision,input,started_at)
        VALUES ('order-plans','p','','','{}','now'), ('prior-specs','s','','','{}','now');
      UPDATE g2b_notice_jobs SET status = 'failed';
      UPDATE g2b_collection_attempts SET status = 'succeeded', attachment_number = 'real-p' WHERE section = 'order-plans';
      UPDATE g2b_collection_attempts SET status = 'succeeded' WHERE section = 'prior-specs';
    `);
    const plan = await queue.event();
    assert.equal(plan.section, 'order-plans');
    assert.equal(plan.number, 'real-p');
    const file = { id: 'file', filename: 'a.pdf' };
    await assert.rejects(queue.consume(plan, [file, null]));
    assert.equal((await queue.event()).id, plan.id);
    assert.equal(await queue.status(file.id), undefined);
    await queue.consume(plan, [file]);
    await queue.consume(plan, [file]);
    const spec = await queue.event();
    assert.equal(spec.section, 'prior-specs');
    await queue.consume(spec, []);
    assert.equal(await queue.event(), undefined);
    await client.execute("UPDATE g2b_notice_jobs SET status = 'succeeded'");
    assert.equal((await queue.event()).revision, '001');
    const plans = await Promise.all([
      "SELECT position FROM g2b_attachment_jobs WHERE status='pending' ORDER BY priority DESC, position LIMIT 1",
      "SELECT position FROM g2b_attachment_jobs WHERE status='retry_wait' AND available_at<=unixepoch()",
      "SELECT position FROM g2b_attachment_jobs WHERE status='running' AND expires_at<=unixepoch()",
      "SELECT id FROM g2b_attachment_events WHERE failed_at IS NULL AND available_at <= unixepoch() ORDER BY available_at, id LIMIT 1",
    ].map((sql) => client.execute('EXPLAIN QUERY PLAN ' + sql)));
    assert.match(String(plans[0].rows[0].detail), /g2b_attachment_ready/);
    assert.match(String(plans[1].rows[0].detail), /g2b_attachment_retry/);
    assert.match(String(plans[2].rows[0].detail), /g2b_attachment_leases/);
    assert.doesNotMatch(String(plans[3].rows[0].detail), /TEMP B-TREE/);
    assert.match(String(plans[3].rows[0].detail), /SEARCH .*g2b_attachment_events_ready/);
  } finally {
    client.close();
  }
});

test('마이그레이션 13은 기존 수집 완료 이벤트를 즉시 처리 가능하게 보존한다', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    await client.executeMultiple(`
      DROP INDEX g2b_attachment_events_ready;
      ALTER TABLE g2b_attachment_events DROP COLUMN available_at;
      ALTER TABLE g2b_attachment_events DROP COLUMN failures;
      ALTER TABLE g2b_attachment_events DROP COLUMN error;
      ALTER TABLE g2b_attachment_events DROP COLUMN failed_at;
      ALTER TABLE g2b_attachment_events DROP COLUMN generation;
      DELETE FROM g2b_schema_migrations WHERE version = 13;
      INSERT INTO g2b_attachment_events(section,number,revision,completion_id) VALUES ('notices','A','000',1);
    `);
    await migrateG2bDatabase(client);
    const queue = openAttachmentQueue(new G2bDatabase(client));
    assert.deepEqual({ ...await queue.event() }, {
      id: 1, section: 'notices', number: 'A', revision: '000', failures: 0, generation: 0,
    });
  } finally {
    client.close();
  }
});

test('실패한 자동 등록을 건너뛰고 재시도를 소진한 이벤트는 복구할 때까지 보존한다', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    const queue = openAttachmentQueue(new G2bDatabase(client));
    await client.execute("INSERT INTO g2b_attachment_events(section,number,revision,completion_id) VALUES ('notices','A','000',1), ('notices','B','000',2)");
    const first = await queue.event();
    assert.equal(first.number, 'A');
    assert.equal((await queue.failEvent(first, '오류')).failures, 1);
    assert.equal(await queue.failEvent(first, '늦은 실패'), undefined);
    assert.equal(await queue.consume(first, [{ id: 'stale', filename: 'stale.pdf' }]), false);
    const next = await queue.event();
    assert.equal(next.number, 'B');
    assert.equal(await queue.consume(next, [{ id: 'current', filename: 'current.pdf' }]), true);
    assert.equal(await queue.consume(next, [{ id: 'current', filename: 'current.pdf' }]), false);
    assert.ok(await queue.status('current'));
    assert.equal(await queue.status('stale'), undefined);
    for (const [index, seconds] of [30, 60, 120].entries()) {
      assert.equal(await queue.event(), undefined);
      const { rows: [row] } = await client.execute('SELECT available_at - unixepoch() AS seconds, failures FROM g2b_attachment_events');
      assert.equal(row.failures, index + 1);
      assert.ok([seconds, seconds - 1].includes(row.seconds));
      await client.execute('UPDATE g2b_attachment_events SET available_at = 0');
      await queue.failEvent(await queue.event(), '오류');
    }
    assert.equal(await queue.event(), undefined);
    const { rows: [failed] } = await client.execute('SELECT failures, error, failed_at FROM g2b_attachment_events');
    assert.equal(failed.failures, 4);
    assert.equal(failed.error, '오류');
    assert.ok(failed.failed_at);
    await client.execute('UPDATE g2b_attachment_events SET failures = 0, available_at = 0, failed_at = NULL, error = NULL, generation = generation + 1');
    assert.equal(await queue.consume(first, []), false);
    assert.equal(await queue.consume(await queue.event(), []), true);
  } finally {
    client.close();
  }
});

test('재시도 시간과 수동 재요청이 시도 상한을 지킨다', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    const queue = openAttachmentQueue(new G2bDatabase(client));
    const file = { id: 'retry', filename: 'a.xlsx' };
    await queue.enqueue(file, false);
    for (const [index, seconds] of [30, 60, 120, 0].entries()) {
      const claim = await queue.claim();
      assert.equal(claim.attempts, index + 1);
      await queue.finish(claim, { error: 'retry', retry: true });
      assert.equal(await queue.claim(), undefined);
      const result = await client.execute('SELECT available_at - unixepoch() AS seconds FROM g2b_attachment_jobs');
      assert.ok([seconds, seconds - 1].includes(result.rows[0].seconds));
      await client.execute('UPDATE g2b_attachment_jobs SET available_at = 0');
    }
    assert.equal((await queue.status(file.id)).status, 'failed');
    assert.equal((await queue.enqueue(file, true)).shouldDispatch, true);
    assert.equal((await queue.claim()).attempts, 1);
  } finally {
    client.close();
  }
});

test('공고 공지 PDF는 본문 HWP보다 우선하며 제안요청 목록도 처리한다', async () => {
  const group = '18ea67ca-9f82-4e49-843a-eb199eea1e92';
  const number = 'R26BK01830377';
  const rows = (filename, permission = null) => ({ dlUntyAtchFileL: [{
    untyAtchFileNo: group, atchFileSqno: 1, orgnlAtchFileNm: filename, scrnIndtYn: 'Y', dwnldPrmsYn: permission,
  }] });
  const notice = {
    payload: { dmItemMap: { bidPbancNo: number, bidPbancOrd: '001', prcmBsneSeCd: '03', scsbdMthdCd: '낙030005' } },
    documents: {
      attachments: rows('규격&#40;안&#41;.hwp'),
      proposal: { dlUntyAtchFileL: [{
        rfpUntyAtchFileNo: group, rfpAtchFileSqno: 1, orgnlAtchFileNm: '제안요청.docx',
        rfpAtchDocRlsYn: 'Y', rfpAtchFileKndCd: '첨020109',
      }] },
    },
    posts: { entries: [{ bbsNo: 'b', pstNo: 'p', detail: { dlPstM: { untyAtchFileNo: group } },
      attachments: rows('규격(안).PDF', 'Y') }] },
  };
  const files = await listAttachmentJobs({ section: 'notices', number, revision: '001' }, { find: async () => notice });
  assert.equal(files.length, 3);
  assert.deepEqual(preferredPdfFiles(files.find((file) => file.filename.endsWith('.hwp')), files).map((file) => file.filename), ['규격(안).PDF']);
  assert.ok(files.some((file) => file.source === 'proposal'));
});

test('스트리밍 해시는 청크 구분과 무관하며 중단하거나 잘린 파일은 완료할 수 없다', async () => {
  const live = new AbortController();
  const hash = await hashAttachmentBody(new Response('abc').body, live.signal, 3);
  const split = new ReadableStream({ start(controller) {
    controller.enqueue(Buffer.from('a'));
    controller.enqueue(Buffer.from('bc'));
    controller.close();
  } });
  assert.equal(await hashAttachmentBody(split, live.signal, 3), hash);
  await assert.rejects(hashAttachmentBody(new Response('ab').body, live.signal, 3), /크기/);
  let canceled = false;
  const waiting = new ReadableStream({ cancel() { canceled = true; } });
  const pending = hashAttachmentBody(waiting, live.signal);
  live.abort();
  await assert.rejects(pending, /abort/i);
  assert.equal(canceled, true);
});

test('저장된 PDF 페이지 하나를 복합 기본 키로 조회한다', async () => {
  const { readAttachmentResultUnit, ATTACHMENT_RESULT_UNIT_SQL } = require('../src/server/g2b/repository/attachment-results');
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    await client.executeMultiple(`
      INSERT INTO g2b_attachment_results(id,hash,format,extractor_version,unit_count,character_count)
      VALUES (1,'a','pdf','v',2,3),(2,'b','pdf','v',1,5);
      INSERT INTO g2b_attachment_result_units VALUES (1,1,'abc'),(1,2,''),(2,1,'other');
    `);
    const db = new G2bDatabase(client);
    assert.deepEqual(await readAttachmentResultUnit(db, 1, 1), { unitNumber: 1, text: 'abc' });
    assert.deepEqual(await readAttachmentResultUnit(db, 1, 2), { unitNumber: 2, text: '' });
    assert.equal(await readAttachmentResultUnit(db, 1, 3), undefined);
    const { rows } = await client.execute({ sql: 'EXPLAIN QUERY PLAN ' + ATTACHMENT_RESULT_UNIT_SQL, args: [1, 2] });
    assert.match(rows[0].detail, /SEARCH .*result_id=\? AND unit_number=\?/);
  } finally {
    client.close();
  }
});

test('PDF 페이지 API는 결과별 서명을 검증하고 유효한 요청만 조회한다', async (t) => {
  const env = { TURSO_DATABASE_URL: ':memory:', TURSO_AUTH_TOKEN: 'pdf-route-test' };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const { getG2bDatabase } = require('../src/server/g2b/repository');
  const { signAttachmentResult } = require('../src/features/download-g2b-attachment/server/attachment-preview-access');
  const { GET } = require('../app/api/g2b/attachment-results/[resultId]/pages/[page]/route');
  const db = getG2bDatabase();
  try {
    await migrateG2bDatabase(db.client);
    await db.client.executeMultiple(`
      INSERT INTO g2b_attachment_results VALUES (1,'test','pdf','v',1,3);
      INSERT INTO g2b_attachment_result_units VALUES (1,1,'abc');
    `);
    const request = (resultId, page, signature) => GET(
      new Request('http://localhost', {
        headers: signature ? { 'X-Attachment-Pdf-Signature': signature } : undefined,
      }),
      { params: Promise.resolve({ resultId, page }) },
    );
    assert.equal((await request('1', '0')).status, 400);
    assert.equal((await request('1', '1')).status, 403);
    assert.equal((await request('2', '1', signAttachmentResult(1))).status, 403);
    assert.equal((await request('1', '2', signAttachmentResult(1))).status, 404);
    const response = await request('1', '1', signAttachmentResult(1));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { pageNumber: 1, text: 'abc' });
  } finally {
    db.client.close();
  }
});
