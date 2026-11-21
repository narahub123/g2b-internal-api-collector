import type { DocumentBlock } from "@/shared/model/g2b/attachment-document";

/** 저장된 블록을 원본 순서대로 표시하며, 표 내부의 블록에도 같은 표시 규칙을 적용한다. */
export function AttachmentDocumentBlocks({ blocks }: { blocks: DocumentBlock[] }) {
  return <div className="grid min-w-0 gap-2">
    {blocks.map((block) => <AttachmentDocumentBlock key={block.id} block={block} />)}
  </div>;
}

/** 문서 문자열은 React 텍스트로 표시하고 표의 병합과 중첩을 복원한다. */
function AttachmentDocumentBlock({ block }: { block: DocumentBlock }) {
  const { table, text, children, notes } = block;
  return <div className="min-w-0">
    {table ? <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {!!table.caption?.length && <caption className={table.captionBelow ? "caption-bottom" : undefined}>
          <AttachmentDocumentBlocks blocks={table.caption} />
        </caption>}
        <tbody>{table.rows.map((cells, row) => <tr key={row}>
          {cells.map((cell) => {
            const Cell = cell.header ? "th" : "td";
            return <Cell key={cell.column} rowSpan={cell.rowSpan} colSpan={cell.colSpan}
              className="border p-2 text-left align-top">
              <AttachmentDocumentBlocks blocks={cell.blocks} />
            </Cell>;
          })}
        </tr>)}</tbody>
      </table>
    </div> : block.kind === "heading" ? (
      <p role="heading" aria-level={block.level ?? 1} className="wrap-anywhere font-semibold">{text}</p>
    ) : block.kind === "separator" ? <hr /> : block.kind === "list" ? (
      <DocumentList block={block} />
    ) : <p className="wrap-anywhere whitespace-pre-wrap">{text ?? (block.kind === "image" ? "[그림]" : "")}</p>}
    {block.kind !== "list" && !!children?.length && <AttachmentDocumentBlocks blocks={children} />}
    {!!notes?.length && <aside className="mt-1 border-l pl-2 text-sm"><AttachmentDocumentBlocks blocks={notes} /></aside>}
  </div>;
}

/** 목록 단계와 항목 순서를 유지하고 항목 안에 들어 있는 블록을 함께 표시한다. */
function DocumentList({ block }: { block: DocumentBlock }) {
  const List = block.ordered ? "ol" : "ul";
  return <List className={block.ordered ? "list-decimal pl-6" : "list-disc pl-6"}>
    {block.text && <li className="whitespace-pre-wrap">{block.text}</li>}
    {block.children?.map((child) => <li key={child.id}><AttachmentDocumentBlock block={child} /></li>)}
  </List>;
}
