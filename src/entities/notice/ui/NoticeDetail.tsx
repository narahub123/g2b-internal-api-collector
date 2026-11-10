import { contractPath, contractRequestPath, orderPlanPath, priorSpecPath } from "@/shared/lib/routes";
import { decodeHTMLStrict } from "entities";
import Link from "next/link";
import { g2bNumber } from "@/shared/model/g2b-number";
import { Accordion } from "@/shared/ui/accordion";
import { NoticePostsSection } from "./NoticePostsSection";
import { AttachmentTable } from "@/shared/ui/attachment-table";
import { DetailAccordionSection } from "@/shared/ui/detail-accordion-section";
import { DetailTitle } from "@/shared/ui/detail-title";
import { resolveG2bBusiness } from "@/shared/lib/g2b-business";
import { RecollectButton } from "@/shared/ui/recollect-button";
import { renderNoticeHtml } from "../lib/notice-html";
import {
  getNoticeAttachmentFiles,
  getNoticeProposalFiles,
  getNoticeDisplay,
  relatedNoticeSectionTitle,
} from "../model/notice-display";
import type { Notice } from "../model/types";

/**
 * 공고 필드값을 HTML 표시 정책에 따라 출력한다.
 * HTML로 처리할 수 없는 값은 엔티티를 디코딩한 일반 텍스트로 표시한다.
 * @param props 수집된 원본 필드값.
 * @returns HTML 또는 일반 텍스트로 표시한 필드값.
 */
function NoticeValue({ value }: { value: string }) {
  const html = renderNoticeHtml(value);
  const className =
    "wrap-anywhere overflow-x-auto whitespace-pre-wrap [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5";
  return html === null ? (
    <div className={className}>{decodeHTMLStrict(value)}</div>
  ) : (
    <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

/**
 * 공고 상세의 표 데이터를 원본 열 순서대로 표시한다.
 * 기초금액조회 항목은 현재 이동 동작을 제공하지 않으므로 비활성 버튼으로 표시한다.
 * @param props 표 제목, 열 이름과 행 데이터.
 * @returns 공고 상세 표.
 */
function NoticeTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: { value?: string; href?: string }[][];
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm" aria-label={title}>
        <thead className="bg-secondary">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-3 py-2 whitespace-nowrap"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t align-top">
              {row.map(({ value, href }, column) => (
                <td key={columns[column]} className="min-w-20 px-3 py-2">
                  {title === "기초금액공개" &&
                  columns[column] === "상세보기" &&
                  value === "기초금액조회" ? (
                    <button
                      type="button"
                      disabled
                      className="rounded border px-3 py-1 text-muted-foreground"
                    >
                      기초금액조회
                    </button>
                  ) : value === undefined ? null : href ? (
                    <a
                      href={href}
                      className="wrap-anywhere text-primary underline underline-offset-2"
                    >
                      {decodeHTMLStrict(value)}
                    </a>
                  ) : (
                    <NoticeValue value={value} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 수집한 입찰공고의 상세 정보, 관련 자료 및 원본 페이지 이동 기능을 표시한다.
 * 제목의 HTML 엔티티 디코딩은 공통 DetailTitle에서 처리하며, 재수집은 기존 요청 기능을 사용한다.
 * @param props 공고 데이터와 저장이 확인된 발주계획번호.
 * @returns 공고 상세 본문과 조건에 따른 관련 정보 및 첨부 목록.
 */
export function NoticeDetail({
  notice,
  orderPlanNumber,
}: {
  notice: Notice;
  orderPlanNumber?: string;
}) {
  const contractLinks = [
    {
      label: "계약요청",
      links: (notice.contractRequests ?? []).map((key) => ({
        ...key,
        href: contractRequestPath(key),
      })),
    },
    {
      label: "계약현황",
      links: (notice.contracts ?? []).map((key) => ({
        ...key,
        href: contractPath(key),
      })),
    },
  ].filter(({ links }) => links.length > 0);
  const sections = getNoticeDisplay(
    notice.payload,
    notice.documents,
    contractLinks.length > 0,
  );
  const attachmentFiles = getNoticeAttachmentFiles(
    notice.payload,
    notice.documents,
  );
  const attachmentHrefBySeq = new Map(
    attachmentFiles.map((file) => [file.seq, file.href] as const),
  );
  const proposalFiles = getNoticeProposalFiles(
    notice.payload,
    notice.documents,
  );

  const proposalHrefBySeq = new Map(
    proposalFiles.map((file) => [file.seq, file.href] as const),
  );
  const { number, revision } = notice;
  const detail = notice.payload.dmItemMap as
    | Record<string, unknown>
    | undefined;
  const methodCode =
    typeof detail?.scsbdMthdCd === "string" ? detail.scsbdMthdCd : "";

  // 현재는 원본 페이지 존재 여부를 알려주는 공고 API 항목이 없어 번호와 차수로 링크를 생성해 항상 표시한다.
  // 향후 해당 정보가 수집되면 원본 페이지의 존재 여부에 따른 표시 조건을 적용할 수 있다.
  const originalHref = `https://www.g2b.go.kr/link/PNPE027_01/single/?${new URLSearchParams(
    {
      bidPbancNo: number,
      bidPbancOrd: revision,
    },
  )}`;

  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <DetailTitle
        headingLevel="h1"
        title={notice.title}
        subtitle={`${number} / ${revision}`}
        business={resolveG2bBusiness(detail?.prcmBsneSeCd, detail?.prcmBsneSeNm)}
        originalHref={originalHref}
        actions={
          <RecollectButton
            endpoint="/api/notices"
            requestBody={{ number, revision, methodCode }}
            compact
          />
        }
      />
      {notice.documents?.unavailable?.map((kind) => (
        <p key={kind} className="text-sm text-muted-foreground">
          {kind === "proposal" && notice.documents?.proposalAccessDenied
            ? "나라장터에서 제안요청정보 조회를 거부했습니다(403)."
            : `${kind === "attachments" ? "파일첨부" : "제안요청정보"}를 가져오지 못했습니다.`}
          {notice.documents?.[kind] && " 이전에 수집한 목록을 표시합니다."}
        </p>
      ))}
      <Accordion
        type="multiple"
        defaultValue={[
          ...(notice.posts?.entries.length ? ["공지사항"] : []),
          ...sections.map(({ title }) => title),
        ]}
        className="min-w-0 border-t"
      >
        {notice.posts && (
          <NoticePostsSection
            posts={notice.posts}
            number={number}
            revision={revision}
          />
        )}
        {sections.map((section) => {
          const { title } = section;
          return "fields" in section ? (
            <DetailAccordionSection key={title} title={title}>
              <dl className="grid gap-4 text-sm">
                {section.fields.map(({ label, value, ...rest }, index) => (
                  <div
                    key={`${index}-${label ?? ""}`}
                    className={
                      label
                        ? "grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]"
                        : "min-w-0"
                    }
                  >
                    {label && (
                      <dt className="text-muted-foreground">{label}</dt>
                    )}
                    <dd>
                      {label === "발주계획번호" && orderPlanNumber === value ? (
                        <Link
                          href={orderPlanPath(value)}
                          className="text-primary underline underline-offset-2"
                        >
                          {value}
                        </Link>
                      ) : label === "사전규격등록번호" && g2bNumber(value) ? (
                        <Link
                          href={priorSpecPath(value.trim())}
                          className="text-primary underline underline-offset-2"
                        >
                          {value}
                        </Link>
                      ) : (
                        <>
                          {"items" in rest && Array.isArray(rest.items) ? (
                            <ul className="list-disc pl-5">
                              {rest.items.map((item, index) => (
                                <li key={index}>{item}</li>
                              ))}
                            </ul>
                          ) : (
                            <NoticeValue value={value} />
                          )}
                          {label === "발주계획번호" && (
                            <p className="text-muted-foreground">
                              아직 수집된 발주계획이 없습니다.
                            </p>
                          )}
                        </>
                      )}
                    </dd>
                  </div>
                ))}
                {title === relatedNoticeSectionTitle &&
                  contractLinks.map(({ label, links }) => (
                    <div
                      key={label}
                      className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd>
                        <ul className="grid gap-1">
                          {links.map(({ number, revision, href }) => (
                            <li key={href}>
                              <Link
                                href={href}
                                className="text-primary underline underline-offset-2"
                              >
                                {number} / {revision}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ))}
              </dl>
              {section.nestedTable && (
                <div className="mt-4 grid gap-2">
                  <h3 className="text-sm font-semibold">
                    {section.nestedTable.title}
                  </h3>
                  <NoticeTable {...section.nestedTable} />
                </div>
              )}
            </DetailAccordionSection>
          ) : (
            <DetailAccordionSection key={title} title={title}>
              {"note" in section && typeof section.note === "string" && (
                <p className="mb-2 text-sm text-muted-foreground">
                  {section.note}
                </p>
              )}
              {title === "파일첨부" ? (
                <AttachmentTable
                  files={attachmentFiles}
                  showDocumentType
                  getDownloadHref={(file) => attachmentHrefBySeq.get(file.seq)}
                />
              ) : title === "제안요청정보" ? (
                <AttachmentTable
                  files={proposalFiles}
                  showDocumentType
                  showFileSize={false}
                  getDownloadHref={(file) => proposalHrefBySeq.get(file.seq)}
                />
              ) : (
                <NoticeTable {...section} />
              )}
            </DetailAccordionSection>
          );
        })}
      </Accordion>
    </article>
  );
}
