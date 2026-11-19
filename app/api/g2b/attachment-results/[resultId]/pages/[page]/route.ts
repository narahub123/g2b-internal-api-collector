import { verifyAttachmentPdfResult } from "@/features/download-g2b-attachment/server/pdf-preview-access";
import { getG2bDatabase } from "@/server/g2b/repository";
import { readAttachmentPdfPage } from "@/server/g2b/repository/attachment-pdf";

const headers = { "Cache-Control": "private, no-store" };

function positiveInteger(value: string) {
  const number = Number(value);
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(number) ? number : undefined;
}

/**
 * 관리자 배포 접근 제어 아래에서 저장된 PDF 페이지 한 장을 JSON으로 반환한다.
 * 잘못된 경로는 400, 서명 오류는 403, 미저장 페이지는 404, 저장소 오류는 500으로 응답한다.
 */
export async function GET(request: Request, { params }: {
  params: Promise<{ resultId: string; page: string }>;
}) {
  const input = await params;
  const resultId = positiveInteger(input.resultId);
  const page = positiveInteger(input.page);
  if (resultId === undefined || page === undefined) {
    return Response.json({ error: "올바르지 않은 PDF 페이지 요청입니다." }, { status: 400, headers });
  }
  if (!verifyAttachmentPdfResult(resultId, request.headers.get("X-Attachment-Pdf-Signature"))) {
    return Response.json({ error: "PDF 페이지를 조회할 권한이 없습니다." }, { status: 403, headers });
  }
  try {
    const result = await readAttachmentPdfPage(getG2bDatabase(), resultId, page);
    return result ? Response.json(result, { headers })
      : Response.json({ error: "저장된 페이지가 없습니다." }, { status: 404, headers });
  } catch (error) {
    console.error("[PDF 추출 페이지 조회]", error);
    return Response.json({ error: "PDF 페이지를 조회하지 못했습니다." }, { status: 500, headers });
  }
}
