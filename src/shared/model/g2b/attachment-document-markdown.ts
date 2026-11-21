import type { AttachmentDocument, DocumentBlock } from "./attachment-document";

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function render(block: DocumentBlock, range?: { start: number; end: number }): string {
  const text = escapeHtml(block.text ?? "");
  const children = block.children?.map((child) => render(child)) ?? [];
  const notes = block.notes?.map((note) => render(note)).join("\n\n");
  const table = block.table;
  let content: string;
  if (table) {
    // 병합 셀은 범위 첫 행에 그 값을 함께 남겨 상위 라벨이 잘리지 않게 한다.
    const caption = table.caption?.map((item) => render(item)).join("\n\n") ?? "";
    const firstBodyRow = table.rows.findIndex((cells) => !cells.length || !cells.every((cell) => cell.header));
    const headerCount = firstBodyRow < 0 ? table.rows.length : firstBodyRow;
    const rows = table.rows.flatMap((cells, row) => {
      const header = row < headerCount;
      if (range && !header && (row < range.start || row > range.end)) return [];
      const carried = range && row === range.start ? table.rows.slice(0, row).flat()
        .filter((cell) => cell.row + cell.rowSpan > row) : [];
      const values = [...carried, ...cells].sort((a, b) => a.column - b.column).map((cell) => {
        const value = cell.blocks.map((item) => render(item)).join("\n\n");
        const sourceRow = table.sourceRows?.[cell.row];
        const sourceColumn = table.sourceColumns?.[cell.column];
        const address = sourceRow !== undefined && sourceColumn !== undefined
          ? ` (R${sourceRow + 1}C${sourceColumn + 1})` : "";
        return `  - 열 ${cell.column + 1}${address} (행 ${cell.rowSpan}칸 × 열 ${cell.colSpan}칸)\n${value.split("\n").map((line) => `    ${line}`).join("\n")}`;
      });
      return values.length ? [`- ${header ? "헤더 · " : ""}행 ${row + 1}\n${values.join("\n")}`] : [];
    });
    content = (table.captionBelow ? [...rows, caption] : [caption, ...rows]).filter(Boolean).join("\n");
  } else if (block.kind === "heading") {
    content = `${"#".repeat(Math.min(6, Math.max(1, block.level ?? 1)))} ${text}`;
  } else if (block.kind === "list") {
    content = [text, ...children].filter(Boolean).map((item, index) =>
      `${block.ordered ? `${index + 1}.` : "-"} ${item.replaceAll("\n", "\n   ")}`).join("\n");
  } else {
    content = [text || (block.kind === "image" ? "[그림]" : ""), ...children].filter(Boolean).join("\n\n");
  }
  return notes ? `${content}\n\n각주\n\n${notes}` : content;
}

/**
 * 선택한 블록을 제목 경로와 위치가 붙은 Markdown으로 생성한다. 제목 선택은 다음 동급 이상 제목까지 포함한다.
 * @param blockId 저장된 블록 ID. 중첩 표도 직접 선택할 수 있다.
 * @param rows 표에서 선택할 0부터 시작하는 양끝 포함 행 범위.
 * @returns 블록을 찾지 못하면 undefined를 반환한다.
 * @throws 행 범위가 선택한 표에 속하지 않으면 RangeError를 발생시킨다.
 */
export function attachmentDocumentMarkdown(document: AttachmentDocument, blockId: string,
  rows?: { start: number; end: number }) {
  const headings: DocumentBlock[] = [];
  const entries = document.units.flatMap((unit) => unit.blocks.map((block) => ({ unit, block })));
  function find(block: DocumentBlock): DocumentBlock | undefined {
    if (block.id === blockId) return block;
    return [...block.children ?? [], ...block.notes ?? [], ...block.table?.caption ?? [],
      ...block.table?.rows.flat(1).flatMap((cell) => cell.blocks) ?? []]
      .map(find).find((match) => match !== undefined);
  }
  for (const [index, { block, unit }] of entries.entries()) {
    if (block.kind === "heading") {
      while (headings.length && (headings.at(-1)?.level ?? 1) >= (block.level ?? 1)) headings.pop();
      headings.push(block);
    }
    const selected = find(block);
    if (!selected) continue;
    if (rows && (!Number.isInteger(rows.start) || !Number.isInteger(rows.end) || rows.start < 0 ||
      rows.end < rows.start || rows.end >= (selected.table?.rows.length ?? 0))) {
      throw new RangeError("표 행 범위가 올바르지 않습니다.");
    }
    const location = unit.location;
    const labels = { page: "쪽", sheet: "시트", slide: "슬라이드", section: "구역" };
    const content = [render(selected, rows)];
    if (selected === block && selected.kind === "heading") {
      for (const entry of entries.slice(index + 1)) {
        if (entry.block.kind === "heading" && (entry.block.level ?? 1) <= (selected.level ?? 1)) break;
        content.push(render(entry.block));
      }
    }
    return [headings.map((heading) => escapeHtml(heading.text ?? "")).join(" > "),
      `근거 블록 ${selected.id}${location ? ` · ${labels[location.kind]} ${location.number}` : ""}`,
      ...content].filter(Boolean).join("\n\n");
  }
  return undefined;
}
