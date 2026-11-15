import { attachmentGroup } from "@/shared/model/g2b/g2b-attachments";
import { decodeHTMLStrict } from "entities";
import type { Notice } from "./types";

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
 * 누리장터 전용 API로 수집한 공고의 원본 result 맵을 읽는다.
 * 이전 상세 응답은 기존 표시 경로에서 읽을 수 있도록 undefined를 반환한다.
 */
export function privateNoticeResult(payload: Record<string, unknown>) {
  const result = payload.result;
  if (result && typeof result === "object" && !Array.isArray(result) && "bidPbancMap" in result) {
    return result as Record<string, unknown>;
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
 * 민간공고의 공고종류를 공통코드 이름, 상세의 이름, 원본 코드 순으로 읽는다.
 * 공통코드 응답이 없는 저장본에서도 상세에 표시할 이름을 얻을 수 있다.
 */
export function privateNoticeKind(detail: Record<string, unknown>, codeNames: Notice["privateCodeNames"]) {
  const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
  const code = text(detail.pbancKndCd);
  return codeNames?.["공44PN000"]?.[code] ?? (text(detail.pbancKndCdNm) || code);
}

/**
 * 저장된 공고종류로 사용자 화면에서 제외할 모의공고를 판별한다.
 * 원본의 괄호는 HTML 엔티티로 저장될 수 있으며, 괄호 안 상태는 공고종류에 영향을 주지 않는다.
 */
export function isMockNotice(notice: Pick<Notice, "payload" | "privateCodeNames">) {
  const payload = notice.payload ?? {};
  const privateDetail = privateNoticeResult(payload)?.bidPbancMap;
  const kind = privateDetail && typeof privateDetail === "object" && !Array.isArray(privateDetail)
    ? privateNoticeKind(privateDetail as Record<string, unknown>, notice.privateCodeNames)
    : noticeDetail(payload).pbancKndNm;
  if (typeof kind !== "string") return false;
  const label = decodeHTMLStrict(kind).trim();
  return label === "모의공고" || /^모의공고\(\s*[^\s()][^()]*\)$/.test(label);
}

/**
 * 저장한 공고 원본에서 파일첨부 목록을 소유하는 그룹을 확인한다.
 * @returns 유효한 첨부 그룹 식별자 또는 undefined.
 */
export function noticeAttachmentGroup(payload: Record<string, unknown>) {
  const privateDetail = privateNoticeResult(payload)?.bidPbancMap;
  if (privateDetail && typeof privateDetail === "object" && "untyAtchFileNo" in privateDetail) {
    return attachmentGroup(privateDetail.untyAtchFileNo);
  }
  return attachmentGroup(etcNoticeDetail(payload)?.untyAtchFileNo ??
    noticeDetail(payload).itemPbancUntyAtchFileNo);
}
