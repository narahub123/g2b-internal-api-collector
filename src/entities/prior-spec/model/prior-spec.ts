import { g2bNumber } from "@/shared/model/g2b-number";

export type PriorSpec = {
  number: string;
  collectedAt: string;
  payload: Record<string, unknown> & { dlBfSpecM: Record<string, unknown> };
  attachments?: Record<string, unknown>;
};

/**
 * 공고 원본에서 사전규격등록번호를 조회한다.
 * @param payload 공고 상세 응답.
 * @returns 연결된 사전규격 번호 또는 undefined.
 */
export function getNoticePriorSpecNumber(payload: Record<string, unknown>) {
  const detail = payload.dmItemMap as Record<string, unknown> | undefined;
  const spec = payload.dlBfSpecM as Record<string, unknown> | undefined;
  return g2bNumber(detail?.bfSpecRegNo) ?? g2bNumber(spec?.bfSpecRegNo);
}

/**
 * 사전규격 상세 경로를 만든다.
 * @param number 사전규격등록번호.
 * @returns 앱의 사전규격 상세 경로.
 */
export function priorSpecPath(number: string) {
  return `/admin/prior-specs/${encodeURIComponent(number)}`;
}
