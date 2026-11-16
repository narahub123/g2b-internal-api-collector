import type { ContractRequestKey } from '@/entities/contract-request/model/contract-request';
import type { ContractKey } from '@/entities/contract/model/contract';
import type { NoticeBaseAmount } from './base-amount';
import type { NoticePosts } from './notice-posts';
import type { orderPlanUnprocessableStatus } from '@/shared/config/g2b-order-plan';

export type NoticeKey = { number: string; revision: string };

export type NoticeSummary = NoticeKey & {
  title: string;
  collectedAt: string;
  businessCode?: string | null;
  businessLabel?: string | null;
};

export type Notice = NoticeSummary & {
  payload: Record<string, unknown>;
  // 원본 공고의 조회 번호와 다를 수 있는, 실제로 저장한 발주계획의 번호.
  orderPlanNumber?: string;
  // 원본 발주계획번호의 상세를 조회했으나 나라장터에서 미존재를 확인한 경우에만 저장한다.
  orderPlanStatus?: typeof orderPlanUnprocessableStatus;
  posts?: NoticePosts;
  baseAmount?: NoticeBaseAmount;
  // 누리장터 변경·취소 공지의 원본 조회 응답이다.
  privatePosts?: { list: Record<string, unknown>; details: ({ raw: Record<string, unknown>; attachments?: Record<string, unknown> } | undefined)[] };
  privateCodeNames?: Record<string, Record<string, string>>;
  contractRequests?: ContractRequestKey[];
  contracts?: ContractKey[];
  documents?: {
    attachments?: Record<string, unknown>;
    proposal?: Record<string, unknown>;
    unavailable?: ('attachments' | 'proposal')[];
    proposalAccessDenied?: boolean;
  };
};
