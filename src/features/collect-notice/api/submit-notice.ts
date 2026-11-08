import type { NoticeKey } from '@/entities/notice';
import type { CollectNoticeInput } from '../model/input';

export async function submitNotice(input: CollectNoticeInput): Promise<NoticeKey> {
  const response = await fetch('/api/notices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? '수집 중 오류가 발생했습니다.');
  return data;
}
