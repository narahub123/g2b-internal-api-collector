import type { ContractRequestKey } from '@/entities/contract-request/model/contract-request';
import type { ContractKey } from '@/entities/contract/model/contract';
import type { NoticePosts } from './notice-posts';

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
  posts?: NoticePosts;
  contractRequests?: ContractRequestKey[];
  contracts?: ContractKey[];
  documents?: {
    attachments?: Record<string, unknown>;
    proposal?: Record<string, unknown>;
    unavailable?: ('attachments' | 'proposal')[];
    proposalAccessDenied?: boolean;
  };
};
