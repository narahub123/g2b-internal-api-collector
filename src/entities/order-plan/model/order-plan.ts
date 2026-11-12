import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import type { NoticeKey } from "@/entities/notice/model/types";
import {
  attachmentGroup,
  publicAttachmentFiles,
} from "@/shared/model/g2b/g2b-attachments";

export type OrderPlan = {
  number: string;
  collectedAt: string;
  payload: Record<string, unknown> & { dlOderPlanM: Record<string, unknown> };
  attachments?: Record<string, unknown>;
};

/**
 * 발주계획에 연결된 통합첨부파일번호를 반환한다.
 * @param plan 저장된 발주계획.
 * @returns 유효한 첨부 그룹 ID 또는 undefined.
 */
export function orderPlanAttachmentGroup(plan: OrderPlan) {
  return attachmentGroup(plan.payload.dlOderPlanM.oderPlanUntyAtchFileNo);
}

/**
 * 발주계획의 공개 첨부를 다운로드 순번과 함께 반환한다.
 * @param plan 저장된 발주계획과 첨부 목록.
 * @returns 해당 계획의 첨부 그룹에서 공개 표시가 허용된 파일 목록.
 */
export function orderPlanFiles(plan: OrderPlan) {
  return publicAttachmentFiles(
    orderPlanAttachmentGroup(plan),
    plan.attachments,
    "order-plan",
  );
}

/**
 * 공고 상세에서 나라장터 발주계획 조회에 사용할 번호를 찾는다.
 * @param payload 수집한 공고 상세 응답.
 * @returns 통합 발주계획번호 또는 기존 상세에 기록된 발주계획번호. 둘 다 비어 있으면 undefined.
 */
export function getNoticeOrderPlanNumber(payload: Record<string, unknown>) {
  const detail = payload.dmItemMap as Record<string, unknown> | undefined;
  for (const number of [detail?.oderPlanUntyNo, detail?.oderPlanNo]) {
    if (typeof number === "string" && /^[A-Z0-9-]{1,30}$/.test(number.trim())) {
      return number.trim();
    }
  }
}

/**
 * 발주계획 응답의 공고 순서와 표시 번호를 보존하고, 공고 수집에서 확인한 연결을 뒤에 추가한다.
 * @param plan 연관 공고 목록을 포함할 수 있는 발주계획 원본.
 * @param linkedNotices 이 발주계획에 연결된 저장 공고. 원본 목록의 번호·차수와 겹치면 생략한다.
 */
export function orderPlanNoticeReferences(plan: OrderPlan, linkedNotices: NoticeKey[] = []) {
  const detail = plan.payload.dlOderPlanM;
  const references = Array.isArray(detail.bidPbancList)
    ? detail.bidPbancList.flatMap((row) => {
        const number = g2bNumber(row?.bidPbancNo);
        const order = row?.bidPbancOrd;
        if (
          !number ||
          (typeof order !== "string" && typeof order !== "number") ||
          !/^\d{1,3}$/.test(String(order))
        )
          return [];

        return [
          {
            number,
            revision: String(order).padStart(3, "0"),
            label: `${number}-${order}`,
          },
        ];
      })
    : [];
  const seen = new Set(references.map(({ number, revision }) => `${number}-${revision}`));
  for (const key of linkedNotices) {
    const label = `${key.number}-${key.revision}`;
    if (seen.has(label)) continue;
    references.push({ ...key, label });
    seen.add(label);
  }
  return references;
}
