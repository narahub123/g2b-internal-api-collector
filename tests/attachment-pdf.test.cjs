require('../scripts/register-project-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { writeFile, truncate, readFile, readdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const { extractPdfProcess, PermanentPdfError, temporaryPdfPath, removeTemporaryPdf } =
  require('../src/features/download-g2b-attachment/server/pdf-process');
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
  const path = temporaryPdfPath();
  const signal = new AbortController().signal;
  const bytes = fixture({ stream: [
    'BT /F1 10 Tf 20 700 Td (1. Estimate) Tj ET',
    'BT /F1 10 Tf 20 550 Td (2. Schedule) Tj ET',
    '20 630 60 30 re S 80 630 180 30 re S',
    'BT /F1 10 Tf 25 642 Td <4142> Tj ET',
    'BT /F1 10 Tf 85 642 Td (Road service) Tj ET',
  ].join('\n') });
  try {
    const hash = await hashAttachmentBody(new Response(bytes).body, signal, bytes.length, path);
    assert.deepEqual(await readFile(path), bytes);
    assert.match(hash, /^[a-f0-9]{64}$/);
    const result = await extractPdfProcess(path, signal);
    assert.equal(result.pages.length, 2);
    assert.match(result.pages[0].text, /1\. Estimate[\s\S]*한글[\s\S]*Road service[\s\S]*2\. Schedule/);
    assert.deepEqual(result.pages[1], { pageNumber: 2, text: '' });
  } finally {
    await removeTemporaryPdf(path);
  }
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('빈 PDF를 완료하고 암호화·손상·페이지·용량 제한을 구분한다', async () => {
  const path = temporaryPdfPath();
  const signal = new AbortController().signal;
  const rejectPdf = async (bytes, message) => {
    await writeFile(path, bytes);
    await assert.rejects(extractPdfProcess(path, signal), (error) =>
      error instanceof PermanentPdfError && message.test(error.message));
  };
  try {
    await writeFile(path, fixture({ stream: 'q 10 0 0 10 10 10 cm BI /W 1 /H 1 /BPC 8 /CS /G ID x EI Q' }));
    assert.equal((await extractPdfProcess(path, signal)).characterCount, 0);
    await rejectPdf(fixture({ encrypted: true }), /암호화/);
    await rejectPdf('%PDF-broken', /손상/);
    await rejectPdf(fixture({ pageCount: 501 }), /500페이지/);
    await truncate(path, 50 * 1024 * 1024 + 1);
    await assert.rejects(extractPdfProcess(path, signal), /50 MiB/);
    const abort = new AbortController();
    const extraction = extractPdfProcess(path, abort.signal);
    abort.abort();
    await assert.rejects(extraction, /abort/i);
  } finally {
    await removeTemporaryPdf(path);
  }
});

test('워커가 신규 PDF를 자동 추출하고 다른 공고의 동일 본문은 기존 결과에 연결한다', async () => {
  const { getG2bDatabase } = require('../src/server/g2b/repository');
  const { migrateG2bDatabase } = require('../src/server/g2b/repository/migrations');
  process.env.TURSO_DATABASE_URL = ':memory:';
  process.env.TURSO_AUTH_TOKEN = 'test';
  const db = getG2bDatabase();
  const stop = new AbortController();
  const originalFetch = global.fetch;
  const bytes = fixture({ stream: 'BT /F1 10 Tf 20 700 Td <4142> Tj ET' });
  let worker;
  try {
    await migrateG2bDatabase(db.client);
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
    global.fetch = async () => new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } });
    worker = runAttachmentWorker(stop.signal);
    const deadline = Date.now() + 15000;
    let jobs;
    do {
      jobs = await db.prepare("SELECT status, hash, pdf_result_id FROM g2b_attachment_jobs WHERE status = 'succeeded'").all();
      if (jobs.length === 2) break;
      await delay(50);
    } while (Date.now() < deadline);
    assert.equal(jobs.length, 2);
    assert.ok(jobs[0].pdf_result_id);
    assert.equal(jobs[0].pdf_result_id, jobs[1].pdf_result_id);
    assert.equal(jobs[0].hash, jobs[1].hash);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM g2b_attachment_pdf_results').get()).count, 1);
    assert.equal((await db.prepare('SELECT text FROM g2b_attachment_pdf_pages WHERE page_number = 1').get()).text, '한글');
  } finally {
    stop.abort();
    await worker;
    global.fetch = originalFetch;
    db.client.close();
  }
  assert.ok(!(await readdir(tmpdir())).some((name) => name.startsWith(`g2b-attachment-pdf-${process.pid}-`)));
});
