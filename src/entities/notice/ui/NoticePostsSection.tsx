import { decodeHTMLStrict } from "entities";
import { Accordion } from "@/shared/ui/accordion";
import type { AttachmentPdfLookup } from "@/shared/model/g2b/attachment-pdf";
import { AttachmentTable } from "@/shared/ui/g2b/AttachmentTable";
import { DetailAccordionSection } from "@/shared/ui/g2b/DetailAccordionSection";
import {
  attachmentGroup,
  publicAttachmentFiles,
} from "@/shared/model/g2b/g2b-attachments";
import { renderNoticeHtml } from "../lib/notice-html";
import {
  noticePostFields,
  noticePostRecord,
  noticePostRows,
  noticePostTitle,
  type NoticePosts,
} from "../model/notice-posts";
import type { NoticeKey } from "../model/types";

/** 저장된 순서대로 공지를 표시하고, 기초금액 공지는 전용 저장 자료의 첨부로 연결한다. */
export function NoticePostsSection({
  posts,
  pdfLookup,
  number,
  revision,
  source,
}: NoticeKey & { posts: NoticePosts; source?: "base-amount"; pdfLookup?: AttachmentPdfLookup }) {
  const rows = noticePostRows(posts.list);
  if (!rows.length) return null;

  return (
    <DetailAccordionSection title="공지사항" heading={source === "base-amount" ? "h3" : "h2"}>
      <Accordion
        type="multiple"
        className="min-w-0 [&_[data-slot=accordion-trigger]]:wrap-anywhere"
      >
        {rows.map(({ row, bbsNo, pstNo }, index) => {
          const value = JSON.stringify([bbsNo, pstNo, index]);
          const post = posts.entries.find(
            (entry) => entry.bbsNo === bbsNo && entry.pstNo === pstNo,
          );
          const detail = noticePostRecord(post?.detail?.dlPstM);
          const body = noticePostRecord(post?.body?.dlPstCnM).bulkPstCn;
          const bodyText = typeof body === "string" ? body : "";
          const html = renderNoticeHtml(bodyText);
          const group = attachmentGroup(detail.untyAtchFileNo);
          const files = publicAttachmentFiles(
            group,
            post?.attachments,
            "notice-post",
          );
          const hasAttachments = files.length > 0;
          const sections = [
            "게시물 상세",
            ...(hasAttachments ? ["게시물 첨부파일"] : []),
          ];

          return (
            <DetailAccordionSection
              key={value}
              value={value}
              title={noticePostTitle(row)}
              heading="h3"
              triggerTitle={
                typeof row.pstNm === "string"
                  ? decodeHTMLStrict(row.pstNm)
                  : undefined
              }
            >
              {post?.detail ? (
                <Accordion
                  type="multiple"
                  defaultValue={sections}
                  className="ml-2 min-w-0 border-t"
                >
                  <DetailAccordionSection title="게시물 상세" heading="h4">
                    <dl className="grid gap-2">
                      {[
                        ...noticePostFields(detail).flat(),
                        { label: "내용", value: bodyText },
                      ].map(({ label, value }) => (
                        <div
                          key={label}
                          className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]"
                        >
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="wrap-anywhere whitespace-pre-wrap">
                            {label === "내용" ? (
                              post.body ? (
                                html !== null ? (
                                  <div
                                    className="wrap-anywhere overflow-x-auto whitespace-pre-wrap [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_h1]:font-bold"
                                    dangerouslySetInnerHTML={{
                                      __html: html,
                                    }}
                                  />
                                ) : (
                                  decodeHTMLStrict(bodyText)
                                )
                              ) : (
                                <p>공지사항 내용을 가져오지 못했습니다.</p>
                              )
                            ) : (
                              value
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </DetailAccordionSection>
                  {hasAttachments && (
                    <DetailAccordionSection
                      title="게시물 첨부파일"
                      heading="h4"
                    >
                      <AttachmentTable
                        files={files}
                        getPdfPreview={pdfLookup && ((seq) => pdfLookup(
                          JSON.stringify([source === "base-amount" ? "base-amount-post" : "notice-post", bbsNo, pstNo]), group, seq,
                        ))}
                        getDownloadHref={({ seq }) =>
                          `/api/notices/${encodeURIComponent(number)}/${encodeURIComponent(revision)}/post-download?${new URLSearchParams({ bbsNo, pstNo, seq, ...(source && { source }) })}`
                        }
                      />
                    </DetailAccordionSection>
                  )}
                </Accordion>
              ) : (
                <p>공지사항 상세를 가져오지 못했습니다.</p>
              )}
            </DetailAccordionSection>
          );
        })}
      </Accordion>
    </DetailAccordionSection>
  );
}
