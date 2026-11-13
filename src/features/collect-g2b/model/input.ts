import type { NoticeKey } from '@/entities/notice';

export type NoticeLookup = { registrationType: string; businessCode: string; rawRevision: string };
export type CollectNoticeInput = NoticeKey & { methodCode: string; lookup?: NoticeLookup };

/** 단건 요청의 필수값을 확인하고 기존 큐와 같은 세 자리 저장 차수를 만든다. */
export function parseCollectNoticeInput(input: unknown): CollectNoticeInput | null {
  if (!input || typeof input !== 'object') return null;
  const { number, revision, methodCode } = input as Partial<CollectNoticeInput>;
  if (typeof number !== 'string' || !number.trim() ||
      typeof revision !== 'string' || !/^\d{1,3}$/.test(revision) ||
      typeof methodCode !== 'string' || methodCode.length > 30) {
    return null;
  }
  return { number: number.trim(), revision: revision.padStart(3, '0'), methodCode };
}
