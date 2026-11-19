import { decodeHTMLStrict } from "entities";
import type { AttachmentOwner } from "@/server/g2b/repository/attachment-queue";
import { loadAttachmentJobs } from "./attachment-preview-data";
import { AttachmentRequestForm } from "./AttachmentRequestForm";
import { requestAttachment } from "./attachment-request";
import { isPdfAttachment } from "@/shared/model/g2b/attachment-pdf";
import { Accordion } from "@/shared/ui/accordion";
import { DetailAccordionSection } from "@/shared/ui/g2b/DetailAccordionSection";

const labels: Record<string, string> = {
  pending: "대기", running: "다운로드 처리 중", retry_wait: "재시도 대기",
  succeeded: "다운로드·해시 확인 완료", failed: "실패",
};

/** 수집 상세의 공개 첨부별 처리 상태와 수동 우선 요청을 표시한다. */
export async function AttachmentJobsSection({ owner }: { owner: AttachmentOwner }) {
  try {
    const jobs = await loadAttachmentJobs(owner.section, owner.number, owner.revision);
    if (!jobs.length) return null;
    const manualEnabled = Boolean(process.env.ATTACHMENT_MANUAL_TOKEN?.trim());
    return (
        <Accordion type="single" collapsible className="bg-white border shadow rounded-md">
          <DetailAccordionSection title="첨부 처리">
            <ul className="space-y-3">
              {jobs.map(({ file, pdfs, status }) => (
                <li key={file.id} className="space-y-1 border-t pt-2">
                  <div className="wrap-anywhere">{decodeHTMLStrict(file.filename)}</div>
                  <div className="text-sm text-muted-foreground">
                    {pdfs.length
                      ? `PDF 우선 처리 · ${pdfs.map((pdf) => decodeHTMLStrict(pdf.filename)).join(", ")}`
                      : status?.pdfResultId != null
                        ? status.characterCount === 0 ? "텍스트 없음" : "PDF 추출 완료"
                        : status?.status === "running" && status.mode === "pdf_extract" ? "PDF 처리 중"
                        : labels[String(status?.status)] ?? "등록 전"}
                    {!!status && ` · ${status.priority === 1 ? "수동" : "자동"}`}
                  </div>
                  {!!status?.hash && <code className="wrap-anywhere text-xs">{String(status.hash)}</code>}
                  {status?.status === "failed" && !!status.error && <p className="text-sm">{String(status.error)}</p>}
                  {manualEnabled && !pdfs.length && (isPdfAttachment(file.filename) ? status?.pdfResultId == null : status?.status !== "succeeded") && (
                    <AttachmentRequestForm action={requestAttachment.bind(null, owner, file.id)}
                      label={isPdfAttachment(file.filename) ? "추출 요청" : "우선 처리 요청"} />
                  )}
                </li>
              ))}
            </ul>
          </DetailAccordionSection>
        </Accordion>
    );
  } catch (error) {
    console.error("[첨부 상태 조회]", error);
    return <p role="status">첨부 처리 상태를 조회하지 못했습니다.</p>;
  }
}
