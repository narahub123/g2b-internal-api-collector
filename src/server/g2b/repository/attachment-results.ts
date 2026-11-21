import type { G2bDatabase } from "./database";
import type { AttachmentDocument, DocumentUnit } from "@/shared/model/g2b/attachment-document";

// 결과 ID와 단위 번호가 복합 기본 키이므로 요청한 본문 한 행만 읽는다.
export const ATTACHMENT_RESULT_UNIT_SQL = `SELECT unit_number, text FROM g2b_attachment_result_units
  WHERE result_id = ? AND unit_number = ?`;

/**
 * 저장된 추출 결과에서 요청한 구조화 단위 또는 기존 텍스트 단위를 읽는다.
 * @param unitNumber 추출기가 반환한 순서를 따르는 1부터 시작하는 번호.
 * @returns 단위가 없으면 undefined를 반환하며, 빈 본문은 빈 문자열로 보존한다.
 * @throws 저장소 조회 실패를 호출자에 전달한다.
 */
export async function readAttachmentResultUnit(db: G2bDatabase, resultId: number, unitNumber: number) {
  const structured = await db.prepare(`SELECT payload FROM g2b_attachment_document_units
    WHERE result_id = ? AND unit_number = ?`).get(resultId, unitNumber);
  if (structured) return {
    unitNumber,
    document: JSON.parse(String(structured.payload)) as DocumentUnit & Pick<AttachmentDocument, "schemaVersion">,
  };
  const row = await db.prepare(ATTACHMENT_RESULT_UNIT_SQL).get(resultId, unitNumber);
  return row && { unitNumber: Number(row.unit_number), text: String(row.text) };
}
