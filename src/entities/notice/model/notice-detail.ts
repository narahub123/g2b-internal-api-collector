import { attachmentGroup } from "@/shared/model/g2b/g2b-attachments";

// 통합검색에서 기타 입찰공고를 식별하는 조달업무구분 코드.
export const etcNoticeBusinessCode = "09";

/**
 * 저장된 상세 응답에서 기타 공고의 데이터 맵을 읽는다.
 * @returns 기타 공고의 원본 필드 또는 일반 공고인 경우 undefined.
 */
export function etcNoticeDetail(payload: Record<string, unknown>) {
  const detail = payload.dlUntyBidPbancM;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    return detail as Record<string, unknown>;
  }
}

/**
 * 업무별 상세 데이터 맵에서 원본 공고 필드를 읽는다.
 * @returns 일반 또는 기타 상세 필드. 맵이 없으면 빈 객체.
 */
export function noticeDetail(payload: Record<string, unknown>) {
  return etcNoticeDetail(payload) ??
    (payload.dmItemMap as Record<string, unknown> | undefined) ?? {};
}

/**
 * 저장한 공고 원본에서 파일첨부 목록을 소유하는 그룹을 확인한다.
 * @returns 유효한 첨부 그룹 식별자 또는 undefined.
 */
export function noticeAttachmentGroup(payload: Record<string, unknown>) {
  return attachmentGroup(etcNoticeDetail(payload)?.untyAtchFileNo ??
    noticeDetail(payload).itemPbancUntyAtchFileNo);
}
