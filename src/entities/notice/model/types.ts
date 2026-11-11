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
