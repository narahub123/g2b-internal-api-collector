/** 저장소와 미리보기가 공유하는 문서 구조다. 셀과 원본 시트 좌표는 0부터 시작한다. */
export type DocumentCell = {
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  header?: boolean;
  blocks: DocumentBlock[];
};

export type DocumentBlock = {
  id: string;
  kind: "paragraph" | "heading" | "list" | "image" | "separator" | "table";
  text?: string;
  level?: number;
  ordered?: boolean;
  page?: number;
  children?: DocumentBlock[];
  notes?: DocumentBlock[];
  table?: {
    rows: DocumentCell[][];
    caption?: DocumentBlock[];
    captionBelow?: boolean;
    sourceRows?: number[];
    sourceColumns?: number[];
  };
};

/** 페이지 또는 연속 블록 묶음이며, 미리보기에서 한 단위씩 읽는다. */
export type DocumentUnit = {
  blocks: DocumentBlock[];
  location?: { kind: "page" | "section" | "sheet" | "slide"; number: number };
  warnings?: { code: string; message: string; page?: number }[];
};

export type AttachmentDocument = { schemaVersion: 1; units: DocumentUnit[] };

/** 셀과 각주의 본문까지 한 번씩 세어 기존 처리 상태의 글자 수를 유지한다. */
export function countDocumentCharacters(blocks: DocumentBlock[]): number {
  return blocks.reduce((total, block) => total + (block.text?.length ?? 0)
    + countDocumentCharacters(block.children ?? [])
    + countDocumentCharacters(block.notes ?? [])
    + countDocumentCharacters(block.table?.caption ?? [])
    + (block.table?.rows.reduce((sum, row) => sum + row.reduce(
      (count, cell) => count + countDocumentCharacters(cell.blocks), 0), 0) ?? 0), 0);
}
