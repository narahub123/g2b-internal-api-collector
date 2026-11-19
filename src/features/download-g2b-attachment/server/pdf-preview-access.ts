import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 관리자 상세에 포함된 결과 ID에 대해서만 페이지 조회용 서명을 발급한다.
 * 배포 인스턴스들이 같은 DB에 연결될 때 동일한 서명을 검증할 수 있다.
 * @returns DB 인증 키가 설정되지 않았으면 undefined를 반환한다.
 */
export function signAttachmentPdfResult(resultId: number) {
  const secret = process.env.TURSO_AUTH_TOKEN?.trim();
  return secret && createHmac("sha256", secret).update(`g2b:attachment-pdf:v1:${resultId}`).digest("hex");
}

/** 페이지를 읽기 전에 관리자 상세에서 발급한 결과별 서명을 상수 시간 비교로 확인한다. */
export function verifyAttachmentPdfResult(resultId: number, signature: string | null) {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = signAttachmentPdfResult(resultId);
  return Boolean(expected && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex")));
}
