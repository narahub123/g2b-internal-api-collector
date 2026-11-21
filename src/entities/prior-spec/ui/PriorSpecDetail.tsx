import type { ReactNode } from "react";
import Link from "next/link";
import {
  attachmentGroup,
  publicAttachmentFiles,
} from "@/shared/model/g2b/g2b-attachments";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import { Accordion } from "@/shared/ui/accordion";
import { DetailAccordionSection } from "@/shared/ui/g2b/DetailAccordionSection";
import { DetailTitle } from "@/shared/ui/g2b/DetailTitle";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import type { PriorSpec } from "../model/prior-spec";
import { priorSpecDisplay } from "../model/prior-spec-display";
import type { AttachmentPreviewLookup } from "@/shared/model/g2b/attachment-extraction";
import { AttachmentTable } from "@/shared/ui/g2b/AttachmentTable";

const linkStyle = "text-primary underline underline-offset-2";

function DetailTable({
  title,
  columns,
  rows,
}: ReturnType<typeof priorSpecDisplay>["tables"][number]) {
  return (
    <DetailAccordionSection title={title} heading="h3">
      <p className="mb-2 text-sm text-muted-foreground">전체 {rows.length}건</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm" aria-label={title}>
          <thead className="bg-secondary">
            <tr>
              {columns.map(({ key, label }) => (
                <th
                  key={key}
                  scope="col"
                  className="whitespace-nowrap px-3 py-2"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className="border-t">
                <td
                  colSpan={columns.length}
                  className="px-3 py-2 text-center text-muted-foreground"
                >
                  조회된 내역이 없습니다.
                </td>
              </tr>
            )}
            {rows.map((row, index) => (
              <tr key={index} className="border-t">
                {columns.map(({ key }, column) => (
                  <td key={key} className="whitespace-pre-wrap px-3 py-2">
                    {row[column]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DetailAccordionSection>
  );
}

/**
 * 사전규격 상세와 복합 목록, 첨부를 원본 순서대로 아코디언에 표시한다.
 * @param props 나라장터 상세 응답과 첨부 목록을 담은 저장된 사전규격와 제목 영역의 동작 및 연관 업무 링크.
 * @returns 페이지에 넣을 사전규격 상세 본문.
 */
export function PriorSpecDetail({
  previewLookup,
  spec,
  orderPlanPath,
  actions,
}: {
  spec: PriorSpec;
  previewLookup?: AttachmentPreviewLookup;
  orderPlanPath: (number: string) => string | undefined | Promise<string | undefined>;
  actions?: ReactNode;
}) {
  const endpoint = `/api/prior-specs/${encodeURIComponent(spec.number)}`;
  const { title, rows, tables, opinions } = priorSpecDisplay(spec.payload);
  const group = attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo);
  const files = publicAttachmentFiles(group, spec.attachments, "prior-spec");
  const pending = Boolean(group && !spec.attachments);
  const showFiles = files.length > 0 || pending;
  const sections = ["기본정보", ...tables.map(({ title }) => title)];
  if (showFiles) sections.push("파일첨부");
  if (opinions) sections.push(opinions.title);

  // 나라장터 사전규격 상세 화면은 사전규격등록번호를 bfSpecRegNo로 전달한다.
  const originalHref = `https://www.g2b.go.kr/link/PRVA004_02/single/?${new URLSearchParams(
    {
      bfSpecRegNo: spec.number,
    },
  )}`;

  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <DetailTitle
        title={title.trim() ? title : "사전규격 상세"}
        subtitle={spec.number}
        business={resolveG2bBusiness(spec.payload.dlBfSpecM.prcmBsneSeCd, spec.payload.dlBfSpecM.prcmBsneSeCdNm)}
        originalHref={originalHref}
        actions={actions}
      />
      <Accordion
        type="multiple"
        defaultValue={sections}
        className="min-w-0 border-t"
      >
        <DetailAccordionSection title="기본정보" heading="h3">
          <dl className="grid gap-3 text-sm">
            {rows.map(async ({ key, label, value, extra, link, prefix, suffix }) => {
              const orderPlan =
                key === "oderPlanNo" ? g2bNumber(value) : undefined;
              const orderPlanHref = orderPlan && await orderPlanPath(orderPlan);
              return (
                <div
                  key={key}
                  className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]"
                >
                  <dt className="whitespace-pre-line text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="min-h-5 wrap-anywhere whitespace-pre-wrap">
                    {key === "linkedDetail" ? (
                      <>
                        <div>{extra}</div>
                        <div>
                          ☞ 클릭 :{" "}
                          {link ? (
                            <a href={link} className={linkStyle}>
                              {value}
                            </a>
                          ) : (
                            value
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        {prefix && <span className="mr-2">{prefix}</span>}
                        {orderPlanHref ? (
                          <Link
                            href={orderPlanHref}
                            className={linkStyle}
                          >
                            {value}
                          </Link>
                        ) : (
                          value
                        )}
                        {suffix && <span className="ml-1">{suffix}</span>}
                        {extra && <div>{extra}</div>}
                      </>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </DetailAccordionSection>
        {tables.map((table) => (
          <DetailTable key={table.title} {...table} />
        ))}
        {showFiles && (
          <DetailAccordionSection title="파일첨부" heading="h3">
            {pending ? (
              <p className="text-muted-foreground">
                첨부 목록이 아직 수집되지 않았습니다.
                {actions && " 재수집으로 조회할 수 있습니다."}
              </p>
            ) : (
              <AttachmentTable
                files={files}
                getAttachmentPreview={previewLookup && ((seq) => previewLookup("prior-spec", group, seq))}
                getDownloadHref={(file) =>
                  `${endpoint}/attachments/${file.seq}`
                }
              />
            )}
          </DetailAccordionSection>
        )}
        {opinions && <DetailTable {...opinions} />}
      </Accordion>
    </article>
  );
}
