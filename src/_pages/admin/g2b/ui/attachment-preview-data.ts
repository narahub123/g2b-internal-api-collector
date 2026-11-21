import { signAttachmentResult } from "@/features/download-g2b-attachment/server/attachment-preview-access";
import { cache } from "react";
import { listAttachmentJobs, preferredPdfFiles } from "@/features/download-g2b-attachment/server/attachment-catalog";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openAttachmentQueue, type AttachmentOwner } from "@/server/g2b/repository/attachment-queue";
import { type AttachmentPreviewLookup, type AttachmentPreview } from "@/shared/model/g2b/attachment-extraction";

/**
 * 상세의 파일 테이블과 첨부 처리 상태 영역이 같은 요청 안에서 작업 조회를 공유한다.
 * @throws 목록 또는 작업 상태 조회 오류를 호출자에 전달한다.
 */
export const loadAttachmentJobs = cache(async (section: AttachmentOwner["section"], number: string, revision: string) => {
  const files = await listAttachmentJobs({ section, number, revision });
  if (!files.length) return [];
  const queue = openAttachmentQueue(getG2bDatabase());
  return Promise.all(files.map(async (file) => ({
    file, pdfs: preferredPdfFiles(file, files), status: await queue.status(file.id),
  })));
});

/**
 * 현재 공개 첨부 행에 연결된 추출 결과의 메타데이터를 찾는다.
 * 상태 저장소가 일시적으로 실패해도 기존 상세와 다운로드 링크는 표시한다.
 */
export async function loadAttachmentPreviewLookup(owner: AttachmentOwner): Promise<AttachmentPreviewLookup> {
  const byFile = new Map<string, AttachmentPreview>();
  try {
    for (const { file, status } of await loadAttachmentJobs(owner.section, owner.number, owner.revision)) {
      const unitCount = Number(status?.unitCount);
      if (status?.resultId != null && unitCount > 0) {
        const resultId = Number(status.resultId);
        const signature = signAttachmentResult(resultId);
        if (signature) byFile.set(JSON.stringify([file.source, file.group, file.seq]), {
          resultId, unitCount, signature, format: String(status.format),
        });
      }
    }
  } catch (error) {
    console.error("[첨부 추출 결과 조회]", error);
  }
  return (source, group, seq) => group ? byFile.get(JSON.stringify([source, group, seq])) : undefined;
}
