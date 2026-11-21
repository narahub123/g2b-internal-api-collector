import { Fragment, type ReactNode } from "react";
import { revisionRoute } from "@/shared/lib/g2b/revision-route";
import type { AttachmentPreviewLookup } from "@/shared/model/g2b/attachment-extraction";
import { publicAttachmentFiles } from "@/shared/model/g2b/g2b-attachments";
import { Accordion } from "@/shared/ui/accordion";
import { DetailAccordionSection } from "@/shared/ui/g2b/DetailAccordionSection";
import { baseAmountAdjustmentFile, getBaseAmountDisplay, type BaseAmountNode } from "../model/base-amount";
import type { Notice } from "../model/types";
import { BaseAmountHelp } from "./BaseAmountDisclosure";
import { NoticePostsSection } from "./NoticePostsSection";
import { NoticeValue } from "./NoticeValue";

type BaseAmountView = ReturnType<typeof getBaseAmountDisplay>;

const cellStyle = "min-w-20 px-3 py-2";
const partLabels = { detail: "기초금액 상세", posts: "공지사항", adjustment: "조사금액 조정사유서" };

// 원본 마크업에서 분리된 제목과 본문을 같은 아코디언 항목에 배치한다.
const sectionGroups = [
  ["taskClCd1", "taskClCd2"],
  ["taskClCd3", "taskClCd4"],
  ["taskClCd5", "taskClCd6"],
  ["tag1"],
  ["prcmBsneSe5", "prcmBsneSe6"],
];

/** 원본의 물품 기초금액 표를 입찰분류와 금액·비고 순서로 표시한다. */
function BaseAmountGrid({ rows }: { rows: BaseAmountView["rows"] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm" aria-label="입찰분류별 기초금액">
        <thead className="bg-secondary">
          <tr>
            {["No", "입찰분류", "기초금액", "참고사항"].map((label) => (
              <th key={label} scope="col" className="whitespace-nowrap px-3 py-2">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr key={index} className="border-t align-top">
              <td className={cellStyle}>{index + 1}</td>
              <td className={cellStyle}>{row.bidClsfNo}</td>
              <td className={cellStyle}>
                {row.bsamt}원{row.bsamtKor && <span className="ml-2">({row.bsamtKor})</span>}
              </td>
              <td className={cellStyle}><NoticeValue value={row.rmrkCn} /></td>
            </tr>
          )) : <tr><td className="p-3 text-center" colSpan={4}>데이터가 없음</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function tableRowGroups(children: BaseAmountNode[]): BaseAmountNode[][] {
  const groups: BaseAmountNode[][] = [];
  let rows: BaseAmountNode[] = [];
  for (const child of children) {
    if (child.kind === "row" && child.children?.length) rows.push(child);
    if (child.kind === "table" || child.kind === "tableBody") {
      if (rows.length) groups.push(rows);
      rows = [];
      // 적격심사 등 하위 행 그룹의 병합 범위가 뒤쪽 행까지 침범하지 않게 한다.
      groups.push(...tableRowGroups(child.children ?? []));
    }
  }
  if (rows.length) groups.push(rows);
  return groups;
}

/**
 * 저장된 원본을 공고 상세의 아코디언과 필드·표 스타일로 표시한다.
 * 미수집과 조회 실패를 구분하고, 공지는 원본 상세의 마지막 위치에 둔다.
 */
export function BaseAmountDetail({ notice, previewLookup }: {
  notice: Notice;
  previewLookup?: AttachmentPreviewLookup;
}) {
  const saved = notice.baseAmount;
  const view = saved?.detail && getBaseAmountDisplay(saved.detail);
  const files = saved?.adjustment;
  const target = saved?.detail && baseAmountAdjustmentFile(saved.detail, view);
  const hasAdjustment = files && target && files.group === target.group && files.seq === target.seq &&
    publicAttachmentFiles(files.group, files.response, "base-amount-adjustment")
      .some((file) => file.seq === target.seq && file.downloadable);
  const adjustmentHref = hasAdjustment
    ? revisionRoute("api/notices", notice) + "/base-amount-adjustment"
    : undefined;
  const posts = saved?.posts?.entries.length ? (
    <NoticePostsSection source="base-amount" posts={saved.posts} previewLookup={previewLookup} number={notice.number} revision={notice.revision} />
  ) : null;
  const visibleNodes = new Map(view ? view.nodes.map((node) => [node.id, node] as const) : []);
  // const help = visibleNodes.get("grpHelpBox");
  const sections = sectionGroups.flatMap(([id, bodyId]) => {
    const [heading, ...remaining] = visibleNodes.get(id)?.children ?? [];
    if (!heading?.text) return [];
    const body = bodyId ? visibleNodes.get(bodyId)?.children ?? [] : [];
    return [{ id, title: heading.text, nodes: [...remaining, ...body] }];
  });

  function render(node: BaseAmountNode): ReactNode {
    const children = node.kind === "table" ? undefined : node.children
      ?.map((child, index) => <Fragment key={child.id ?? index}>{render(child)}</Fragment>);
    switch (node.kind) {
      case "posts": return posts;
      case "grid": return <BaseAmountGrid rows={view.rows} />;
      case "table": {
        const groups = tableRowGroups(node.children ?? []);
        if (!groups.length) return null;
        return (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              {groups.map((rows, groupIndex) => (
                <tbody key={groupIndex}>
                  {rows.map((row, rowIndex) => (
                    <Fragment key={row.id ?? rowIndex}>
                      {render({
                        ...row,
                        children: row.children?.map((cell) => cell.rowSpan
                          ? { ...cell, rowSpan: Math.min(cell.rowSpan, rows.length - rowIndex) }
                          : cell),
                      })}
                    </Fragment>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        );
      }
      case "tableBody": return children;
      case "row": return <tr className="border-b align-top last:border-b-0">{children}</tr>;
      case "label": return (
        <th
          scope={node.rowSpan ? "rowgroup" : "row"}
          colSpan={node.colSpan}
          rowSpan={node.rowSpan}
          className={cellStyle + " bg-secondary font-medium text-muted-foreground"}
        >
          {children}
        </th>
      );
      case "cell": return <td colSpan={node.colSpan} rowSpan={node.rowSpan} className={cellStyle}>{children}</td>;
      case "heading": return <h3 className="text-base font-semibold">{node.text}</h3>;
      case "text": return <NoticeValue value={node.text ?? ""} inline />;
      case "list": return <ul className="list-disc pl-5">{children}</ul>;
      case "item": return <li>{children}</li>;
      case "paragraph": return <p>{children}</p>;
      case "break": return <br />;
      case "download": {
        const adjustment = node.id === "btnInvsAmtAdjsSmrs";
        return adjustment && adjustmentHref ? (
          <a className="mr-3 text-primary underline underline-offset-2" href={adjustmentHref}>{node.text}</a>
        ) : (
          <span className="mr-3 text-muted-foreground" title={adjustment ? undefined : view.standardFilename}>
            {node.text} (다운로드 불가)
          </span>
        );
      }
      case "group": return node.id === "grpHelpBox"
        ? <BaseAmountHelp>{children}</BaseAmountHelp>
        : <div className="grid min-w-0 gap-2">{children}</div>;
    }
  }

  return (
    <div className="grid min-w-0 gap-3 text-sm">
      {!view && (
        <p className="text-muted-foreground">
          {saved?.unavailable?.includes("detail")
            ? "기초금액 상세를 가져오지 못했습니다. 공고를 다시 수집해 주세요."
            : "기초금액 상세가 아직 수집되지 않았습니다. 공고를 재수집하면 확인할 수 있습니다."}
        </p>
      )}
      {saved?.retained?.map((part) => (
        <p key={part} className="text-muted-foreground">{partLabels[part]}의 이전 수집 자료를 표시합니다.</p>
      ))}
      {saved?.unavailable?.includes("posts") && !saved.retained?.includes("posts") && (
        <p className="text-muted-foreground">기초금액 공지사항을 가져오지 못했습니다.</p>
      )}
      {/* {help && render(help)} */}
      {(sections.length > 0 || posts) && (
        <Accordion type="multiple" defaultValue={[...sections.map(({ id }) => id), "공지사항"]} className="min-w-0 border-t">
          {sections.map(({ id, title, nodes }) => (
            <DetailAccordionSection key={id} value={id} title={title} heading="h4">
              <div className="grid min-w-0 gap-2">
                {id === "taskClCd3" ? (
                  <>
                    <div className="flex items-center gap-1">
                      {nodes.slice(0, 3).map((node, index) => <Fragment key={node.id ?? index}>{render(node)}</Fragment>)}
                    </div>
                    {nodes.slice(3).map((node, index) => <Fragment key={node.id ?? index}>{render(node)}</Fragment>)}
                  </>
                ) : nodes.map((node, index) => <Fragment key={node.id ?? index}>{render(node)}</Fragment>)}
              </div>
            </DetailAccordionSection>
          ))}
          {posts}
        </Accordion>
      )}
    </div>
  );
}
