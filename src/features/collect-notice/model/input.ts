import type { NoticeKey } from '@/entities/notice';

export type CollectNoticeInput = NoticeKey & { methodCode: string };

export function parseCollectNoticeInput(input: unknown): CollectNoticeInput | null {
  if (!input || typeof input !== 'object') return null;
  const { number, revision, methodCode } = input as Partial<CollectNoticeInput>;
  if (typeof number !== 'string' || !/^[A-Z0-9-]{1,30}$/.test(number) ||
      typeof revision !== 'string' || !/^\d{3}$/.test(revision) ||
      typeof methodCode !== 'string' || methodCode.length > 30) {
    return null;
  }
  return { number, revision, methodCode };
}
