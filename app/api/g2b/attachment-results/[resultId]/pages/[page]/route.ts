import { verifyAttachmentResult } from "@/features/download-g2b-attachment/server/attachment-preview-access";
import { getG2bDatabase } from "@/server/g2b/repository";
import { readAttachmentResultUnit } from "@/server/g2b/repository/attachment-results";

const headers = { "Cache-Control": "private, no-store" };

function positiveInteger(value: string) {
  const number = Number(value);
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(number) ? number : undefined;
}

/**
 * 관리자 접근 제어 아래에서 구조화 단위 한 건 또는 기존 PDF 페이지 텍스트를 반환한다.
 * 잘못된 경로는 400, 서명 오류는 403, 미저장 페이지는 404, 저장소 오류는 500으로 응답한다.
 */
export async function GET(request: Request, { params }: {
  params: Promise<{ resultId: string; page: string }>;
}) {
  const input = await params;
  const resultId = positiveInteger(input.resultId);
  const page = positiveInteger(input.page);
  if (resultId === undefined || page === undefined) {
    return Response.json({ error: "올바르지 않은 추출 페이지 요청입니다." }, { status: 400, headers });
  }
  if (!verifyAttachmentResult(resultId, request.headers.get("X-Attachment-Pdf-Signature"))) {
    return Response.json({ error: "추출 페이지를 조회할 권한이 없습니다." }, { status: 403, headers });
  }
  try {
    const result = await readAttachmentResultUnit(getG2bDatabase(), resultId, page);
    // 기존 PDF 미리보기 클라이언트가 사용하는 응답 필드를 유지한다.
    return result ? Response.json("document" in result
      ? { pageNumber: result.unitNumber, document: result.document }
      : { pageNumber: result.unitNumber, text: result.text }, { headers })
      : Response.json({ error: "저장된 페이지가 없습니다." }, { status: 404, headers });
  } catch (error) {
    console.error("[첨부 추출 페이지 조회]", error);
    return Response.json({ error: "추출 페이지를 조회하지 못했습니다." }, { status: 500, headers });
  }
}
