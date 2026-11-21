// 빌드에서 준비된 모델만 읽고 실행 중 외부 요청을 차단한다.
process.env.KORDOC_OFFLINE = "1";
if (process.env.ATTACHMENT_MODEL_CACHE) process.env.KORDOC_MODEL_CACHE = process.env.ATTACHMENT_MODEL_CACHE;
const { parse } = require("kordoc");

const permanentCodes = new Set([
  "EMPTY_INPUT", "UNSUPPORTED_FORMAT", "ENCRYPTED", "DRM_PROTECTED", "CORRUPTED",
  "DECOMPRESSION_BOMB", "ZIP_BOMB", "NO_SECTIONS", "OUTPUT_TOO_LARGE",
]);

/** 파서의 순서와 셀 배치를 프로젝트 문서 타입으로 옮긴다. */
function normalize(result) {
  let sequence = 0;
  function convertRows(table) {
    const covered = new Set();
    return table.cells.map((cells, row) => cells.flatMap((cell, column) => {
      if (covered.has(row * table.cols + column) || !cell) return [];
      const rowSpan = Math.max(1, Math.min(cell.rowSpan, table.rows - row));
      const colSpan = Math.max(1, Math.min(cell.colSpan, table.cols - column));
      // 일부 형식은 덮인 칸도 빈 셀 객체로 반환하므로 기준 셀의 범위로 제외한다.
      for (let r = row; r < row + rowSpan; r++) {
        for (let c = column; c < column + colSpan; c++) covered.add(r * table.cols + c);
      }
      return [{
        row, column, rowSpan, colSpan,
        header: cell.isHeader || (table.hasHeader && row === 0) || undefined,
        blocks: cell.blocks?.length ? cell.blocks.map(convert)
          : cell.text ? [convert({ type: "paragraph", text: cell.text })] : [],
      }];
    }));
  }
  function convert(block) {
    const id = String(++sequence);
    const { type: kind, level, pageNumber: page, children, footnoteBlocks, footnoteText, table } = block;
    return {
      id, kind, level, page,
      text: table ? undefined : block.text,
      ordered: kind === "list" ? block.listType === "ordered" : undefined,
      children: children?.map(convert),
      notes: footnoteBlocks?.length ? footnoteBlocks.map(convert)
        : footnoteText ? [convert({ type: "paragraph", text: footnoteText })] : undefined,
      table: table && {
        caption: table.captionBlocks?.length ? table.captionBlocks.map(convert)
          : table.caption ? [convert({ type: "paragraph", text: table.caption })] : undefined,
        captionBelow: table.captionBelow,
        sourceRows: table.sourceRows,
        sourceColumns: table.sourceCols,
        rows: convertRows(table),
      },
    };
  }

  const units = [];
  const locationKind = result.fileType === "xlsx" || result.fileType === "xls" ? "sheet"
    : result.fileType === "pptx" ? "slide"
    : result.metadata?.pageMode === "section" ? "section" : "page";
  let unit;
  for (const block of result.blocks) {
    const number = block.pageNumber ?? unit?.location?.number;
    if (!unit || number !== unit.location?.number ||
        (!number && (block.type === "heading" || unit.blocks.length >= 40))) {
      unit = { blocks: [], location: number ? { kind: locationKind, number } : undefined };
      units.push(unit);
    }
    unit.blocks.push(convert(block));
  }
  // PDF의 빈 페이지도 미리보기 번호를 유지한다.
  if (result.fileType === "pdf" && result.pageCount && units.every((item, index) =>
    item.location && item.location.number <= result.pageCount &&
    (index === 0 || item.location.number > units[index - 1].location.number))) {
    const pages = new Map(units.map((item) => [item.location.number, item]));
    units.length = 0;
    for (let number = 1; number <= result.pageCount; number++) {
      units.push(pages.get(number) ?? { blocks: [], location: { kind: "page", number } });
    }
  }
  if (!units.length) units.push({ blocks: [] });
  if (result.warnings?.length) {
    units[0].warnings = result.warnings.map(({ code, message, page }) => ({ code, message, page }));
  }
  return { schemaVersion: 1, units };
}

/** 로컬 파싱을 실행하고 결과 또는 오류를 IPC로 한 번 전송한다. */
async function main() {
  let message;
  try {
    const parsed = await parse(process.argv[2], {
      ocr: true, ocrRec: "printed", images: false, layoutTables: "keep",
      removeHeaderFooter: false, hancomFallback: false,
    });
    if (!parsed.success) {
      message = { error: parsed.error, permanent: permanentCodes.has(parsed.code) };
    } else if (parsed.warnings?.some(({ code }) => code === "OCR_FAILED" || code === "NEEDS_OCR")) {
      const warning = parsed.warnings.find(({ code }) => code === "OCR_FAILED" || code === "NEEDS_OCR");
      message = { error: `필요한 페이지의 OCR을 완료하지 못했습니다. ${warning.message}` };
    } else {
      message = { result: { document: normalize(parsed) } };
    }
  } catch (error) {
    message = { error: error.message };
  }
  process.send(message, () => process.disconnect());
}

void main();
