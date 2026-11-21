require('../scripts/register-project-typescript.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadStream } = require('node:fs');
const { open, readFile } = require('node:fs/promises');
const { Readable } = require('node:stream');
const { deflateSync } = require('node:zlib');
const { hashAttachmentBody } = require('../src/features/download-g2b-attachment/server/attachment-worker');
const { runExtractionProcess, temporaryAttachmentPath, removeTemporaryAttachment } =
  require('../src/features/download-g2b-attachment/server/extraction-process');
const { pdfExtractor } = require("../src/shared/model/g2b/attachment-extraction");

// 압축 이미지와 벡터 표를 모두 실제 페이지에 배치해 PDF 크기와 추출 부하를 재현한다.
async function writeFixture(path) {
  const file = await open(path, 'wx', 0o600);
  const offsets = [];
  const pageCount = 500;
  const imagePages = 240;
  const pixels = Buffer.alloc(256 * 256 * 3);
  let seed = 982451653;
  let size = 0;
  async function write(bytes) {
    await file.writeFile(bytes);
    size += typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.length;
  }
  async function object(id, dictionary, stream) {
    offsets[id] = size;
    await write(`${id} 0 obj\n${dictionary}`);
    if (stream) {
      await write('\nstream\n');
      await write(stream);
      await write('\nendstream');
    }
    await write('\nendobj\n');
  }
  try {
    await write('%PDF-1.4\n');
    await object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    const kids = Array.from({ length: pageCount }, (_, index) => `${4 + index * 2} 0 R`).join(' ');
    await object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} /MediaBox [0 0 600 800] >>`);
    await object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    for (let index = 0; index < pageCount; index++) {
      const page = 4 + index * 2;
      const image = index < imagePages ? 4 + pageCount * 2 + index : null;
      const resources = image ? `/XObject << /Im ${image} 0 R >>` : '';
      await object(page, `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> ${resources} >> /Contents ${page + 1} 0 R >>`);
      const drawing = [image ? 'q 90 0 0 90 450 690 cm /Im Do Q' : '',
        `BT /F1 14 Tf 20 760 Td (Page ${index + 1}) Tj ET`,
        'BT /F1 12 Tf 20 90 Td (End of schedule) Tj ET'];
      for (let row = 0; row < 24; row++) {
        for (let column = 0; column < 4; column++) {
          const x = 20 + column * 130;
          const y = 660 - row * 22;
          drawing.push(`${x} ${y} 130 22 re S`,
            `BT /F1 10 Tf ${x + 4} ${y + 8} Td (Row ${row + 1} Column ${column + 1}) Tj ET`);
        }
      }
      const stream = Buffer.from(drawing.join('\n'));
      await object(page + 1, `<< /Length ${stream.length} >>`, stream);
      if (image) {
        for (let byte = 0; byte < pixels.length; byte++) {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          pixels[byte] = seed;
        }
        const compressed = deflateSync(pixels);
        await object(image, `<< /Type /XObject /Subtype /Image /Width 256 /Height 256 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>`, compressed);
      }
    }
    const xref = size;
    await write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    await write(offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join(''));
    await write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return size;
  } finally {
    await file.close();
  }
}

async function memoryEvents() {
  const values = await readFile('/sys/fs/cgroup/memory.events', 'utf8');
  return Object.fromEntries(values.trim().split('\n').map((line) => line.split(' ')));
}

test('512 MiB 컨테이너에서 500페이지 이미지·벡터 표 PDF를 제한 시간 내 추출한다', { timeout: 330_000 }, async (t) => {
  const limit = 512 * 1024 * 1024;
  assert.equal(Number(await readFile('/sys/fs/cgroup/memory.max', 'utf8')), limit);
  const before = await memoryEvents();
  const source = temporaryAttachmentPath();
  const input = temporaryAttachmentPath();
  try {
    const bytes = await writeFixture(source);
    assert.ok(bytes > 45 * 1024 * 1024 && bytes <= 50 * 1024 * 1024, `PDF 크기: ${bytes}`);
    const download = Readable.toWeb(createReadStream(source));
    const started = performance.now();
    assert.match(await hashAttachmentBody(download, t.signal, bytes, { path: input, extractor: pdfExtractor }), /^[a-f0-9]{64}$/);
    const result = await runExtractionProcess(pdfExtractor, input, t.signal);
    assert.equal(result.units.length, 500);
    for (const [index, page] of result.units.entries()) {
      assert.ok(page.startsWith(`Page ${index + 1}\n`), `페이지 제목 누락: ${index + 1}`);
      assert.match(page, /Row 1 Column 1[\s\S]*Row 1 Column 4[\s\S]*Row 24 Column 4[\s\S]*End of schedule/);
    }
    const after = await memoryEvents();
    assert.equal(after.oom, before.oom, 'cgroup OOM 발생');
    assert.equal(after.oom_kill, before.oom_kill, 'cgroup OOM 종료 발생');
    const peak = Number(await readFile('/sys/fs/cgroup/memory.peak', 'utf8'));
    assert.ok(peak < limit);
    t.diagnostic(`PDF ${(bytes / 1024 ** 2).toFixed(1)} MiB · 최대 메모리 ${(peak / 1024 ** 2).toFixed(1)} MiB · 처리 ${((performance.now() - started) / 1000).toFixed(1)}초`);
  } finally {
    await removeTemporaryAttachment(input);
    await removeTemporaryAttachment(source);
  }
});
