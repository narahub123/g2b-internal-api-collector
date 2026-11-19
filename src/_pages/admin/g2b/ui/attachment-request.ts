"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { getG2bDatabase } from "@/server/g2b/repository";
import { dispatchPendingAttachments } from "@/features/download-g2b-attachment/server/attachment-actions";
import { openAttachmentQueue, type AttachmentOwner } from "@/server/g2b/repository/attachment-queue";
import { listAttachmentJobs, preferredPdfFiles } from "@/features/download-g2b-attachment/server/attachment-catalog";
import { decodeHTMLStrict } from "entities";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/** 관리자 토큰을 확인해 작업을 저장하고, 원격 모드에서는 대기 작업의 실행을 요청한다. */
export async function requestAttachment(owner: AttachmentOwner, id: string, _previous: string, form: FormData) {
  const token = process.env.ATTACHMENT_MANUAL_TOKEN?.trim();
  const submitted = form.get("token");
  if (!token || typeof submitted !== "string" || !timingSafeEqual(digest(token), digest(submitted))) {
    return "관리자 토큰을 확인하세요.";
  }
  if (!["notices", "order-plans", "prior-specs"].includes(owner.section) || !/^[a-f0-9]{64}$/.test(id)) {
    return "첨부 요청 정보가 올바르지 않습니다.";
  }
  try {
    const files = await listAttachmentJobs(owner);
    const file = files.find((candidate) => candidate.id === id);
    if (!file) return "현재 다운로드 가능한 첨부를 찾을 수 없습니다.";
    const pdfs = preferredPdfFiles(file, files);
    if (pdfs.length) return `대응 PDF를 선택하세요. ${pdfs.map((pdf) => decodeHTMLStrict(pdf.filename)).join(", ")}`;
    const result = await openAttachmentQueue(getG2bDatabase()).enqueue(file, true);
    const job = result?.job;
    if (job?.pdfResultId != null) return job.characterCount === 0 ? "텍스트 없음" : "PDF 추출 완료";
    if (job?.status === "succeeded") return `다운로드·해시 확인 완료 ${job.hash}`;
    if (job?.status === "running") return job.mode === "pdf_extract" ? "추출 요청 반영 · 처리 중" : "다운로드 처리 중";
    if (result?.shouldDispatch && process.env.ATTACHMENT_WORKER_MODE === "github-actions") {
      try {
        await dispatchPendingAttachments();
      } catch (error) {
        // 접수는 이미 확정됐다. 호출에 실패한 작업은 다음 예약 실행에서 처리한다.
        console.error("[첨부 워커 실행 요청]", error);
      }
    }
    return "수동 처리 대기";
  } catch (error) {
    console.error("[첨부 수동 등록]", error);
    return "첨부 작업을 등록하지 못했습니다.";
  }
}
