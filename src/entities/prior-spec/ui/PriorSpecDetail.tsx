import { decodeHTMLStrict } from "entities";
import Link from "next/link";
import { orderPlanPath } from "@/entities/order-plan/model/order-plan";
import {
  attachmentGroup,
  publicAttachmentFiles,
} from "@/shared/model/g2b-attachments";
import { g2bNumber } from "@/shared/model/g2b-number";
import { Accordion } from "@/shared/ui/accordion";
import { DetailAccordionSection } from "@/shared/ui/detail-accordion-section";
import { RecollectButton } from "@/shared/ui/recollect-button";
import type { PriorSpec } from "../model/prior-spec";
import { priorSpecDisplay } from "../model/prior-spec-display";

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
 * @param props 나라장터 상세 응답과 첨부 목록을 담은 저장된 사전규격.
 * @returns 페이지에 넣을 사전규격 상세 본문.
 */
export function PriorSpecDetail({ spec }: { spec: PriorSpec }) {
  const { title, rows, tables, opinions } = priorSpecDisplay(spec.payload);
  const endpoint = `/api/prior-specs/${encodeURIComponent(spec.number)}`;
  const group = attachmentGroup(spec.payload.dlBfSpecM.untyAtchFileNo);
  const files = publicAttachmentFiles(group, spec.attachments, "prior-spec");
  const pending = Boolean(group && !spec.attachments);
  const showFiles = files.length > 0 || pending;
  const sections = ["기본정보", ...tables.map(({ title }) => title)];
  if (showFiles) sections.push("파일첨부");
  if (opinions) sections.push(opinions.title);

  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h2 className="wrap-anywhere text-xl font-semibold">
            {title.trim() ? title : "사전규격 상세"}
          </h2>
          <p className="text-sm text-muted-foreground">{spec.number}</p>
        </div>
        <RecollectButton endpoint={endpoint} />
      </header>
      <Accordion
        type="multiple"
        defaultValue={sections}
        className="min-w-0 border-t"
      >
        <DetailAccordionSection title="기본정보" heading="h3">
          <dl className="grid gap-3 text-sm">
            {rows.map(({ key, label, value, extra, link, prefix, suffix }) => {
              const orderPlan =
                key === "oderPlanNo" ? g2bNumber(value) : undefined;
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
                        {orderPlan ? (
                          <Link
                            href={orderPlanPath(orderPlan)}
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
                첨부 목록이 아직 수집되지 않았습니다. 재수집으로 조회할 수
                있습니다.
              </p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {files.map(({ filename, seq, downloadable }) => (
                  <li key={seq} className="wrap-anywhere">
                    {downloadable ? (
                      <a
                        href={`${endpoint}/attachments/${seq}`}
                        className={linkStyle}
                      >
                        {decodeHTMLStrict(filename)}
                      </a>
                    ) : (
                      decodeHTMLStrict(filename)
                    )}
                  </li>
                ))}
              </ul>
            )}
          </DetailAccordionSection>
        )}
        {opinions && <DetailTable {...opinions} />}
      </Accordion>
    </article>
  );
}
