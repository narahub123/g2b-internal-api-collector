require('../scripts/register-project-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { G2bDatabase } = require('../src/server/g2b/repository/database');
const { migrateG2bDatabase } = require('../src/server/g2b/repository/migrations');
const { openAttachmentQueue } = require('../src/server/g2b/repository/attachment-queue');
const { listAttachmentJobs, preferredPdfFiles } = require('../src/features/download-g2b-attachment/server/attachment-catalog');
const { hashAttachmentBody } = require('../src/features/download-g2b-attachment/server/attachment-worker');
const { PDF_EXTRACTOR_VERSION } = require('../src/shared/model/g2b/attachment-pdf');

test('마이그레이션 14는 배포 전 모든 PDF 상태에서 해시 처리 모드를 유지한다', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    await client.executeMultiple(`
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

test('기존 PDF는 자동 인계에서 처리 모드를 보존하고 실행 중 수동 요청은 완료 후 이어진다', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    const queue = openAttachmentQueue(new G2bDatabase(client));
    const old = { id: 'old', filename: 'old.pdf' };
    const fresh = { id: 'fresh', filename: 'fresh.PDF' };
    await client.execute({ sql: 'INSERT INTO g2b_attachment_jobs(id,file,priority) VALUES (?,?,0)', args: [old.id, JSON.stringify(old)] });
    await client.execute("INSERT INTO g2b_attachment_events(section,number,revision,completion_id) VALUES ('notices','A','000',1)");
    await queue.consume(await queue.event(), [old, fresh]);
    const legacy = await queue.claim();
    assert.equal(legacy.mode, 'hash_only');
    await queue.enqueue(old, true);
    assert.equal((await queue.status(old.id)).status, 'running');
    assert.equal(await queue.finish(legacy, { hash: 'same' }), true);
    const manual = await queue.claim();
    assert.equal(manual.file.id, old.id);
    assert.equal(manual.mode, 'pdf_extract');
    const stale = { ...manual, token: legacy.token };
    assert.equal(await queue.finish(stale, { hash: 'stale', pdf: {
      version: PDF_EXTRACTOR_VERSION, pages: [{ pageNumber: 1, text: '미반영' }], characterCount: 3,
    } }), false);
    assert.equal(await queue.hasPdf('stale'), false);
    await queue.finish(manual, { hash: 'same', pdf: { version: PDF_EXTRACTOR_VERSION, pages: [{ pageNumber: 1, text: '본문' }], characterCount: 2 } });
    const automatic = await queue.claim();
    assert.equal(automatic.mode, 'pdf_extract');
    assert.equal(await queue.hasPdf('same'), true);
    assert.equal(await queue.finish(automatic, { hash: 'same', pdf: { version: PDF_EXTRACTOR_VERSION } }), true);
    assert.equal((await queue.status(old.id)).pdfResultId, (await queue.status(fresh.id)).pdfResultId);
    assert.ok((await queue.status(old.id)).pdfResultId);
    const legacyDone = { id: 'done', filename: 'done.pdf' };
    await client.execute({ sql: "INSERT INTO g2b_attachment_jobs(id,file,priority,status,hash) VALUES (?,?,0,'succeeded','same')",
      args: [legacyDone.id, JSON.stringify(legacyDone)] });
    assert.equal((await queue.enqueue(legacyDone, true)).pdfResultId, (await queue.status(old.id)).pdfResultId);
    assert.equal(await queue.claim(), undefined);
    const lookup = await client.execute("EXPLAIN QUERY PLAN SELECT id FROM g2b_attachment_pdf_results WHERE hash = 'same' AND version = 'v1'");
    assert.match(lookup.rows[0].detail, /SEARCH .* USING COVERING INDEX/);
  } finally {
    client.close();
  }
});

test('수동 작업은 자동 작업보다 먼저 실행되고 만료된 실행권은 결과를 저장할 수 없다', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await migrateG2bDatabase(client);
    const queue = openAttachmentQueue(new G2bDatabase(client));
    const file = { id: 'automatic', filename: 'a.xlsx' };
    await queue.enqueue(file, false);
    await queue.enqueue({ ...file, id: 'manual' }, false);
    await queue.enqueue({ ...file, id: 'manual' }, true);
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
    await queue.enqueue(file, true);
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
