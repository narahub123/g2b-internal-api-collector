require('../scripts/register-project-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { writeFile, truncate, readFile, readdir, mkdtemp, unlink, rmdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { runExtractionProcess, PermanentExtractionError, temporaryAttachmentPath, removeTemporaryAttachment } =
  require('../src/features/download-g2b-attachment/server/extraction-process');
const { pdfExtractor } = require("../src/shared/model/g2b/attachment-extraction");
const { hashAttachmentBody, runAttachmentWorker } = require('../src/features/download-g2b-attachment/server/attachment-worker');

function fixture({ stream = '', pageCount = 2, encrypted = false } = {}) {
  const unicode = '1 begincodespacerange\n<00> <FF>\nendcodespacerange\n2 beginbfchar\n<41> <D55C>\n<42> <AE00>\nendbfchar';
  const pages = Array.from({ length: pageCount }, (_, index) => index ? '<< /Type /Page /Parent 2 0 R >>'
    : '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>');
  const kids = pages.map((_, index) => `${index + 6} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} /MediaBox [0 0 600 800] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 4 0 R >>',
    `<< /Length ${unicode.length} >>\nstream\n${unicode}\nendstream`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ...pages,
  ];
  if (encrypted) objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> /P -4 >>`);
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  const encrypt = encrypted ? `/Encrypt ${objects.length} 0 R /ID [<${'01'.repeat(16)}><${'01'.repeat(16)}>]` : '';
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypt} >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test('PDF 자식 프로세스는 한글·표 순서·빈 페이지를 추출하며 다운로드 바이트를 그대로 사용한다', async () => {
  const path = temporaryAttachmentPath();
  const signal = new AbortController().signal;
  const bytes = fixture({ stream: [
    'BT /F1 10 Tf 20 700 Td (1. Estimate) Tj ET',
    'BT /F1 10 Tf 20 550 Td (2. Schedule) Tj ET',
    '20 630 60 30 re S 80 630 180 30 re S',
    'BT /F1 10 Tf 25 642 Td <4142> Tj ET',
    'BT /F1 10 Tf 85 642 Td (Road service) Tj ET',
  ].join('\n') });
  try {
    const hash = await hashAttachmentBody(new Response(bytes).body, signal, bytes.length, { path, extractor: pdfExtractor });
    assert.deepEqual(await readFile(path), bytes);
    assert.match(hash, /^[a-f0-9]{64}$/);
    const result = await runExtractionProcess(pdfExtractor, path, signal);
    assert.equal(result.units.length, 2);
    assert.match(result.units[0], /1\. Estimate[\s\S]*한글[\s\S]*Road service[\s\S]*2\. Schedule/);
    assert.equal(result.units[1], '');
  } finally {
    await removeTemporaryAttachment(path);
  }
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('빈 PDF를 완료하고 암호화·손상·페이지·용량 제한을 구분한다', async () => {
  const path = temporaryAttachmentPath();
  const signal = new AbortController().signal;
  const rejectPdf = async (bytes, message) => {
    await writeFile(path, bytes);
    await assert.rejects(runExtractionProcess(pdfExtractor, path, signal), (error) =>
      error instanceof PermanentExtractionError && message.test(error.message));
  };
  try {
    await writeFile(path, fixture({ stream: 'q 10 0 0 10 10 10 cm BI /W 1 /H 1 /BPC 8 /CS /G ID x EI Q' }));
    assert.equal((await runExtractionProcess(pdfExtractor, path, signal)).units.join(''), '');
    await rejectPdf(fixture({ encrypted: true }), /암호화/);
    await rejectPdf('%PDF-broken', /손상/);
    await rejectPdf(fixture({ pageCount: 501 }), /500페이지/);
    await truncate(path, 50 * 1024 * 1024 + 1);
    await assert.rejects(runExtractionProcess(pdfExtractor, path, signal), /50 MiB/);
    const abort = new AbortController();
    const extraction = runExtractionProcess(pdfExtractor, path, abort.signal);
    abort.abort();
    await assert.rejects(extraction, /abort/i);
  } finally {
    await removeTemporaryAttachment(path);
  }
});

test('일회 워커가 수동 호출 실패를 복구하고 선점 기한 이후 남은 PDF를 다음 실행에 넘긴다', async (t) => {
  const { getG2bDatabase } = require('../src/server/g2b/repository');
  const { migrateG2bDatabase } = require('../src/server/g2b/repository/migrations');
  process.env.TURSO_DATABASE_URL = ':memory:';
  process.env.TURSO_AUTH_TOKEN = 'test';
  const db = getG2bDatabase();
  const stop = new AbortController();
  const originalFetch = global.fetch;
  const bytes = fixture({ pageCount: 1, stream: `BT /F1 10 Tf 20 700 Td <${'4142'.repeat(24)}> Tj ET` });
  try {
    await migrateG2bDatabase(db.client);
    const { requestAttachment } = require('../src/_pages/admin/g2b/ui/attachment-request');
    const { listAttachmentJobs } = require('../src/features/download-g2b-attachment/server/attachment-catalog');
    const { openAttachmentQueue } = require('../src/server/g2b/repository/attachment-queue');
    const queue = openAttachmentQueue(db);
    const empty = performance.now();
    await runAttachmentWorker(stop.signal, { once: true });
    assert.ok(performance.now() - empty < 4500, '빈 큐의 일회 실행은 유휴 대기하지 않는다');
    const group = '18ea67ca-9f82-4e49-843a-eb199eea1e92';
    for (const number of ['R26BK01830377', 'R26BK01830378']) {
      const notice = {
        payload: { dmItemMap: { bidPbancNo: number, bidPbancOrd: '000', prcmBsneSeCd: '03', untyAtchFileNo: group } },
        documents: { attachments: { dlUntyAtchFileL: [{
          untyAtchFileNo: group, atchFileSqno: 1, orgnlAtchFileNm: 'test.pdf', scrnIndtYn: 'Y', fileSz: bytes.length,
        }] } },
      };
      await db.prepare("INSERT INTO notices(number,revision,collected_at,data,query_data) VALUES (?,'000','test',?,'{}')")
        .run(number, JSON.stringify(notice));
      await db.prepare("INSERT INTO g2b_notice_jobs(number,revision,input,force,status) VALUES (?,'000','{}',0,'pending')")
        .run(number);
    }
    await db.prepare("UPDATE g2b_notice_jobs SET status = 'succeeded'").run();
    const owner = { section: 'notices', number: 'R26BK01830378', revision: '000' };
    const [manualFile] = await listAttachmentJobs(owner);
    process.env.ATTACHMENT_WORKER_MODE = 'github-actions';
    process.env.ATTACHMENT_MANUAL_TOKEN = 'test-admin';
    process.env.NOTICE_GITHUB_REPOSITORY = 'example/project';
    process.env.NOTICE_GITHUB_REF = 'main';
    process.env.NOTICE_GITHUB_TOKEN = 'test-actions-token';
    const form = new FormData();
    form.set('token', 'test-admin');
    let dispatches = 0;
    global.fetch = async (url, request) => {
      assert.match(String(url), /\/attachment-processing\.yml\/dispatches$/);
      assert.equal(request.method, 'POST');
      assert.equal((await queue.status(manualFile.id)).priority, 1);
      dispatches++;
      return new Response(null, { status: 503 });
    };
    const responses = await Promise.all(Array.from({ length: 3 }, () => requestAttachment(owner, manualFile.id, '', form)));
    assert.deepEqual(responses, ['수동 처리 대기', '수동 처리 대기', '수동 처리 대기']);
    assert.equal(dispatches, 1);
    let now = 0;
    const clock = t.mock.method(performance, 'now', () => now);
    global.fetch = async (url) => {
      assert.match(String(url), /R26BK01830378/);
      now = 300_001;
      return new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } });
    };
    await runAttachmentWorker(stop.signal, { once: true });
    clock.mock.restore();
    assert.equal((await queue.status(manualFile.id)).status, 'succeeded');
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM g2b_attachment_jobs WHERE status = 'pending'").get()).count, 1);
    global.fetch = async (url) => {
      assert.match(String(url), /R26BK01830377/);
      return new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } });
    };
    await runAttachmentWorker(stop.signal, { once: true });
    assert.equal(await requestAttachment(owner, manualFile.id, '', form), '추출 완료');
    assert.equal(dispatches, 1);
    const jobs = await db.prepare("SELECT status, hash, result_id FROM g2b_attachment_jobs WHERE status = 'succeeded'").all();
    assert.equal(jobs.length, 2);
    assert.ok(jobs[0].result_id);
    assert.equal(jobs[0].result_id, jobs[1].result_id);
    assert.equal(jobs[0].hash, jobs[1].hash);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM g2b_attachment_results').get()).count, 1);
    assert.equal((await db.prepare('SELECT count(*) AS count FROM g2b_attachment_result_units').get()).count, 0);
    const { readAttachmentResultUnit } = require('../src/server/g2b/repository/attachment-results');
    const stored = await readAttachmentResultUnit(db, jobs[0].result_id, 1);
    assert.equal(stored.document.schemaVersion, 1);
    assert.match(stored.document.blocks[0].text, /한글/);
    const { signAttachmentResult } = require('../src/features/download-g2b-attachment/server/attachment-preview-access');
    const { GET } = require('../app/api/g2b/attachment-results/[resultId]/pages/[page]/route');
    const resultId = jobs[0].result_id;
    const response = await GET(new Request('http://localhost', {
      headers: { 'X-Attachment-Pdf-Signature': signAttachmentResult(resultId) },
    }), { params: Promise.resolve({ resultId: String(resultId), page: '1' }) });
    assert.deepEqual(await response.json(), { pageNumber: 1, document: stored.document });
    const lookup = await db.client.execute(`EXPLAIN QUERY PLAN SELECT payload
      FROM g2b_attachment_document_units WHERE result_id = 1 AND unit_number = 1`);
    assert.match(lookup.rows[0].detail, /SEARCH .* USING INDEX/);

    await t.test('registered non-PDF extractor uses automatic and manual jobs and the preview API', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'attachment-extractor-test-'));
      const entrypoint = join(directory, 'extract.cjs');
      try {
        await writeFile(entrypoint, "const text = require('node:fs').readFileSync(process.argv[2], 'utf8');\n" +
          "process.send({ result: { units: [text, ''] } }, () => process.disconnect());\n");
        const extractor = { ...pdfExtractor, format: 'testdoc', version: 'v1', entrypoint };
        const resolveExtractor = (filename) => filename.endsWith('.testdoc') ? extractor : undefined;
        const testQueue = openAttachmentQueue(db, undefined, resolveExtractor);
        const text = 'test document';
        const numbers = ['R26BK01830379', 'R26BK01830380'];
        for (const number of numbers) {
          const notice = {
            payload: { dmItemMap: { bidPbancNo: number, bidPbancOrd: '000', prcmBsneSeCd: '03', untyAtchFileNo: group } },
            documents: { attachments: { dlUntyAtchFileL: [{
              untyAtchFileNo: group, atchFileSqno: 1, orgnlAtchFileNm: 'test.testdoc', scrnIndtYn: 'Y', fileSz: Buffer.byteLength(text),
            }] } },
          };
          await db.prepare("INSERT INTO notices(number,revision,collected_at,data,query_data) VALUES (?,'000','test',?,'{}')")
            .run(number, JSON.stringify(notice));
        }
        await db.prepare("INSERT INTO g2b_attachment_events(section,number,revision,completion_id) VALUES ('notices',?,'000',1)")
          .run(numbers[0]);
        const manualOwner = { ...owner, number: numbers[1] };
        const [testFile] = await listAttachmentJobs(manualOwner);
        assert.equal((await testQueue.enqueue(testFile, true)).job.mode, 'extract');
        global.fetch = async () => new Response(text);
        await runAttachmentWorker(stop.signal, { once: true, resolveExtractor });
        const [autoFile] = await listAttachmentJobs({ ...owner, number: numbers[0] });
        const manual = await testQueue.status(testFile.id);
        const automatic = await testQueue.status(autoFile.id);
        assert.equal(manual.status, 'succeeded');
        assert.equal(automatic.status, 'succeeded');
        assert.equal(automatic.resultId, manual.resultId);
        const { loadAttachmentPreviewLookup } = require('../src/_pages/admin/g2b/ui/attachment-preview-data');
        const lookup = await loadAttachmentPreviewLookup(manualOwner);
        const preview = lookup(testFile.source, testFile.group, testFile.seq);
        assert.equal(preview.format, 'testdoc');
        assert.equal(preview.unitCount, 2);
        const { GET } = require('../app/api/g2b/attachment-results/[resultId]/pages/[page]/route');
        const response = await GET(new Request('http://localhost', {
          headers: { 'X-Attachment-Pdf-Signature': preview.signature },
        }), { params: Promise.resolve({ resultId: String(preview.resultId), page: '1' }) });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { pageNumber: 1, text });
      } finally {
        await unlink(entrypoint).catch((error) => { if (error.code !== 'ENOENT') throw error; });
        await rmdir(directory);
      }
    });
  } finally {
    stop.abort();
    global.fetch = originalFetch;
    db.client.close();
  }
  assert.ok(!(await readdir(tmpdir())).some((name) => name.startsWith(`g2b-attachment-source-${process.pid}-`)));
});
