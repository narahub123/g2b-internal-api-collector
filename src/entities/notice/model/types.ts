import type { OrderPlan } from '@/entities/order-plan/model/order-plan';

export type NoticeKey = { number: string; revision: string };

export type NoticeSummary = NoticeKey & {
  title: string;
  collectedAt: string;
};

export type Notice = NoticeSummary & {
  payload: Record<string, unknown>;
  documents?: {
    attachments?: Record<string, unknown>;
    proposal?: Record<string, unknown>;
    unavailable?: ('attachments' | 'proposal')[];
    proposalAccessDenied?: boolean;
  };
};

export interface NoticeRepository {
  list(): Promise<NoticeSummary[]>;
  find(key: NoticeKey): Promise<Notice | null>;
  save(notice: Notice): Promise<void>;
  /**
   * 발주계획을 번호로 조회한다.
   * @param number 조회할 발주계획번호.
   * @returns 저장된 계획 또는 null.
   */
  findOrderPlan(number: string): OrderPlan | null;
  /**
   * 발주계획을 최초 한 번 저장한다. 같은 번호가 있으면 기존 자료를 유지한다.
   * @param plan 수집한 발주계획과 원본 응답.
   */
  saveOrderPlan(plan: OrderPlan): void;
  /**
   * 최초 수집한 첨부 목록을 계획 원본에 추가한다.
   * @param number 이미 저장된 발주계획번호.
   * @param attachments 첨부 목록 API 원본 응답.
   */
  saveOrderPlanAttachments(number: string, attachments: Record<string, unknown>): void;
  /**
   * 발주계획을 참조하는 로컬 공고를 조회한다.
   * @param number 발주계획번호.
   * @returns 공고번호와 차수 목록.
   */
  findNoticesForOrderPlan(number: string): NoticeKey[];
}
