import type { G2bDatabase } from "./database";

// 결과와 페이지 번호가 복합 기본 키이므로 요청한 페이지 한 행만 읽는다.
export const ATTACHMENT_PDF_PAGE_SQL = `SELECT page_number, text FROM g2b_attachment_pdf_pages
  WHERE result_id = ? AND page_number = ?`;

/**
 * 저장된 추출 결과에서 요청한 페이지를 읽는다.
 * @returns 페이지가 없으면 undefined를 반환하며, 빈 페이지는 빈 문자열로 보존한다.
 * @throws 저장소 조회 실패를 호출자에 전달한다.
 */
export async function readAttachmentPdfPage(db: G2bDatabase, resultId: number, page: number) {
  const row = await db.prepare(ATTACHMENT_PDF_PAGE_SQL).get(resultId, page);
  return row && { pageNumber: Number(row.page_number), text: String(row.text) };
}
