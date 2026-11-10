import { decodeHTMLStrict } from "entities";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/shared/ui/accordion";
import { AttachmentTable } from "@/shared/ui/attachment-table";
import { DetailAccordionSection } from "@/shared/ui/detail-accordion-section";
import { attachmentGroup, publicAttachmentFiles } from "@/shared/model/g2b-attachments";
import { renderNoticeHtml } from "../lib/notice-html";
import { noticePostFields, noticePostRecord, noticePostRows, noticePostTitle, type NoticePosts } from "../model/notice-posts";
import type { NoticeKey } from "../model/types";

/** 저장된 공지 목록 순서대로 게시글과 내부 상세 섹션을 표시한다. */
export function NoticePostsSection({ posts, number, revision }: NoticeKey & { posts: NoticePosts }) {
  const rows = noticePostRows(posts.list);
  if (!rows.length) return null;

  return (
    <section aria-label="공지사항" className="min-w-0">
      <h2 className="px-2 text-base font-semibold">공지사항</h2>
      <Accordion type="multiple" className="min-w-0">
        {rows.map(({ row, bbsNo, pstNo }, index) => {
          const value = JSON.stringify([bbsNo, pstNo, index]);
          const post = posts.entries.find((entry) => entry.bbsNo === bbsNo && entry.pstNo === pstNo);
          const detail = noticePostRecord(post?.detail?.dlPstM);
          const body = noticePostRecord(post?.body?.dlPstCnM).bulkPstCn;
          const bodyText = typeof body === "string" ? body : "";
          const html = renderNoticeHtml(bodyText);
          const group = attachmentGroup(detail.untyAtchFileNo);
          const files = publicAttachmentFiles(group, post?.attachments, "notice-post");
          const hasAttachments = files.length > 0;
          const sections = ["게시물 상세", "내용", ...(hasAttachments ? ["게시물 첨부파일"] : [])];

          return (
            <AccordionItem key={value} value={value} className="min-w-0">
              <AccordionTrigger heading="h3" className="wrap-anywhere px-2" title={typeof row.pstNm === "string" ? decodeHTMLStrict(row.pstNm) : undefined}>
                {noticePostTitle(row)}
              </AccordionTrigger>
              <AccordionContent className="pl-4">
                {post?.detail ? (
                  <Accordion type="multiple" defaultValue={sections} className="min-w-0 border-t">
                    <DetailAccordionSection title="게시물 상세" heading="h4">
                      <div className="grid gap-4">
                        {noticePostFields(detail).map((fields) => (
                          <dl key={fields[0].label} className={fields.length > 1 ? "grid gap-4 sm:grid-cols-2" : undefined}>
                            {fields.map(({ label, value }) => (
                              <div key={label} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
                                <dt className="text-muted-foreground">{label}</dt>
                                <dd className="wrap-anywhere whitespace-pre-wrap">{value}</dd>
                              </div>
                            ))}
                          </dl>
                        ))}
                      </div>
                    </DetailAccordionSection>
                    <DetailAccordionSection title="내용" heading="h4">
                      {post.body ? (
                        html !== null
                          ? <div className="wrap-anywhere" dangerouslySetInnerHTML={{ __html: html }} />
                          : <div className="wrap-anywhere whitespace-pre-wrap">{decodeHTMLStrict(bodyText)}</div>
                      ) : <p>공지사항 내용을 가져오지 못했습니다.</p>}
                    </DetailAccordionSection>
                    {hasAttachments && (
                      <DetailAccordionSection title="게시물 첨부파일" heading="h4">
                        <AttachmentTable files={files} getDownloadHref={({ seq }) =>
                          `/api/notices/${encodeURIComponent(number)}/${encodeURIComponent(revision)}/post-download?${new URLSearchParams({ bbsNo, pstNo, seq })}`
                        } />
                      </DetailAccordionSection>
                    )}
                  </Accordion>
                ) : <p>공지사항 상세를 가져오지 못했습니다.</p>}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </section>
  );
}
