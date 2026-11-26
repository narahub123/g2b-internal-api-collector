import type { ReactNode } from "react";
import Link from "next/link";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import { Accordion } from "@/shared/ui/accordion";
import { DetailAccordionSection } from "@/shared/ui/g2b/DetailAccordionSection";
import { DetailTitle } from "@/shared/ui/g2b/DetailTitle";
import { DetailInterest } from "@/features/g2b-interest/DetailInterest";
import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { orderPlanSections } from "../model/order-plan-display";
import {
  orderPlanAttachmentGroup,
  orderPlanFiles,
  orderPlanNoticeReferences,
  type OrderPlan,
} from "../model/order-plan";
import type { AttachmentPreviewLookup } from "@/shared/model/g2b/attachment-extraction";
import { AttachmentTable } from "@/shared/ui/g2b/AttachmentTable";

const rowClass = "grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]";
const linkClass = "text-primary underline underline-offset-2";

/**
 * 발주계획 상세, 첨부파일과 연관 정보 링크를 독립적인 본문으로 표시한다.
 * @param props 저장된 발주계획, 수집으로 확인한 연관 공고 목록과 업무별 링크 및 제목 영역 동작.
 * @returns 페이지에 넣을 발주계획 본문.
 */
export function OrderPlanDetail({
  previewLookup,
  plan,
  notices,
  noticePath,
  priorSpecPath,
  actions,
}: {
  plan: OrderPlan;
  previewLookup?: AttachmentPreviewLookup;
  notices: ReturnType<typeof orderPlanNoticeReferences>;
  noticePath: (key: { number: string; revision: string }) => string | undefined;
  priorSpecPath: (number: string) => string | undefined | Promise<string | undefined>;
  actions?: ReactNode;
}) {
  const detail = plan.payload.dlOderPlanM;
  const title = [detail.bizNm, detail.itemNm].find(
    (value): value is string =>
      typeof value === "string" && Boolean(value.trim()),
  );
  const specifications = Array.isArray(detail.bfSpecRegList)
    ? detail.bfSpecRegList
        .map((row) => g2bNumber(row?.bfSpecRegNo))
        .filter((number): number is string => number !== undefined)
    : [];
  const files = orderPlanFiles(plan);
  const attachmentsPending = Boolean(
    orderPlanAttachmentGroup(plan) && !plan.attachments,
  );
  const showAttachments = files.length > 0 || attachmentsPending;
  const groups = orderPlanSections(plan.payload);
  const sections = [...groups.map(({ title }) => title), "연관 정보"];
  if (showAttachments) sections.push("파일첨부");

  // 나라장터 발주계획 상세 화면은 발주계획번호를 oderPlanNo로 전달한다.
  const originalHref = `https://www.g2b.go.kr/link/PRPA015_01/single/?${new URLSearchParams(
    {
      oderPlanNo: plan.number,
    },
  )}`;

  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      {/* 동일 업무를 보는 사용자·관리자 상세에서 공통 관심 상태를 표시한다. */}
      <DetailTitle
        interest={<DetailInterest item={{ type: "order-plans", number: plan.number, revision: "" }} />}
        title={title ?? "발주계획 상세"}
        subtitle={plan.number}
        business={resolveG2bBusiness(detail.prcmBsneSeCd, detail.prcmBsneSeCdNm)}
        originalHref={originalHref}
        actions={actions}
      />
      <Accordion
        type="multiple"
        defaultValue={sections}
        className="min-w-0 border-t"
      >
        {groups.map(({ title, rows }) => (
          <DetailAccordionSection key={title} title={title} heading="h3">
            <dl className="grid gap-3 text-sm">
              {rows.map(({ label, value, prefix, suffix }) => (
                <div key={label} className={rowClass}>
                  <dt className="whitespace-pre-line text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="min-h-5 wrap-anywhere whitespace-pre-wrap">
                    {prefix && <span className="mr-2">{prefix}</span>}
                    {value}
                    {suffix && <span className="ml-1">{suffix}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </DetailAccordionSection>
        ))}
        <DetailAccordionSection title="연관 정보" heading="h3">
          <dl className="grid gap-3 text-sm">
            <div className={rowClass}>
              <dt className="text-muted-foreground">사전규격번호</dt>
              <dd className="min-h-5">
                {specifications.length > 0 && (
                  <ul className="grid gap-2">
                    {specifications.map(async (number, index) => {
                      const href = await priorSpecPath(number);
                      return (
                        <li key={JSON.stringify([number, index])} className="wrap-anywhere">
                          {href ? <Link href={href} className={linkClass}>{number}</Link> : number}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </dd>
            </div>
            <div className={rowClass}>
              <dt className="text-muted-foreground">입찰공고번호</dt>
              <dd className="min-h-5">
                {notices.length > 0 && (
                  <ul className="grid gap-2">
                    {notices.map(({ label, ...key }, index) => {
                      const href = noticePath(key);
                      return (
                        <li key={JSON.stringify([label, index])} className="wrap-anywhere">
                          {href ? <Link href={href} className={linkClass}>{label}</Link> : label}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        </DetailAccordionSection>
        {showAttachments && (
          <DetailAccordionSection title="파일첨부" heading="h3">
            {attachmentsPending ? (
              <p className="text-muted-foreground">
                첨부 목록이 아직 수집되지 않았습니다.
                {actions && " 재수집으로 첨부 목록을 조회할 수 있습니다."}
              </p>
            ) : (
              <AttachmentTable
                files={files}
                getAttachmentPreview={previewLookup && ((seq) => previewLookup("order-plan", orderPlanAttachmentGroup(plan), seq))}
                getDownloadHref={(file) =>
                  `/api/order-plans/${encodeURIComponent(plan.number)}/attachments/${file.seq}`
                }
              />
            )}
          </DetailAccordionSection>
        )}
      </Accordion>
    </article>
  );
}
