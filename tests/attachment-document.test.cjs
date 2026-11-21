require('../scripts/register-project-typescript.cjs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { writeFile } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { markdownToHwpx } = require('kordoc');
const { findAttachmentExtractor } = require('../src/shared/model/g2b/attachment-extraction');
const { attachmentDocumentMarkdown } = require('../src/shared/model/g2b/attachment-document-markdown');
const { runExtractionProcess, temporaryAttachmentPath, removeTemporaryAttachment, PermanentExtractionError } =
  require('../src/features/download-g2b-attachment/server/extraction-process');

test('HWPX를 제목, 병합 셀, 위치를 가진 문서 JSON으로 변환한다', async () => {
  const path = temporaryAttachmentPath();
  try {
    const hwpx = await markdownToHwpx([
      '# 입찰 안내', '',
      '<table><tr><th>구분</th><th>서류</th></tr>',
      '<tr><td rowspan="2">제출서류</td><td>제안서</td></tr>',
      '<tr><td>사업자등록증</td></tr></table>',
    ].join('\n'));
    await writeFile(path, Buffer.from(hwpx));
    const extractor = findAttachmentExtractor('제출안내.hwpx');
    const signal = new AbortController().signal;
    const result = await runExtractionProcess(extractor, path, signal);
    assert.deepEqual(Object.keys(result), ['document']);
    const blocks = result.document.units.flatMap((unit) => unit.blocks);
    const table = blocks.find((block) => block.kind === 'table');
    assert.equal(table.table.rows[1][0].rowSpan, 2);
    assert.equal(table.table.rows[2][0].column, 1);
    const excerpt = attachmentDocumentMarkdown(result.document, table.id, { start: 2, end: 2 });
    assert.match(excerpt, /입찰 안내[\s\S]*근거 블록[\s\S]*헤더[\s\S]*제출서류[\s\S]*사업자등록증/);
    assert.doesNotMatch(excerpt, /제안서/);
    await writeFile(path, 'invalid document');
    await assert.rejects(runExtractionProcess(extractor, path, signal), PermanentExtractionError);
  } finally {
    await removeTemporaryAttachment(path);
  }
});

test('XLSX는 시트와 원본 셀 위치를 유지한다', async () => {
  const JSZip = createRequire(require.resolve('kordoc'))('jszip');
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="제출 항목" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData><row r="3"><c r="B3" t="inlineStr"><is><t>구분</t></is></c>' +
    '<c r="D3" t="inlineStr"><is><t>내용</t></is></c></row>' +
    '<row r="5"><c r="B5" t="inlineStr"><is><t>제출서류</t></is></c>' +
    '<c r="D5" t="inlineStr"><is><t>제안서</t></is></c></row></sheetData></worksheet>');
  const path = temporaryAttachmentPath();
  try {
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }));
    const { document } = await runExtractionProcess(findAttachmentExtractor('목록.xlsx'), path, new AbortController().signal);
    assert.deepEqual(document.units[0].location, { kind: 'sheet', number: 1 });
    const table = document.units[0].blocks.find((block) => block.kind === 'table');
    const markdown = attachmentDocumentMarkdown(document, table.id);
    assert.match(markdown, /제출 항목[\s\S]*시트 1[\s\S]*R5C4[\s\S]*제안서/);
  } finally {
    await removeTemporaryAttachment(path);
  }
});
