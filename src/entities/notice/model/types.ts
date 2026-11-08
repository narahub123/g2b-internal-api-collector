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
}
