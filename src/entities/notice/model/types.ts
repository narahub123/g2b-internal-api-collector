export type NoticeKey = { number: string; revision: string };

export type Notice = NoticeKey & {
  title: string;
  collectedAt: string;
  payload: Record<string, unknown>;
};

export interface NoticeRepository {
  list(): Promise<Notice[]>;
  find(key: NoticeKey): Promise<Notice | null>;
  save(notice: Notice): Promise<void>;
}
