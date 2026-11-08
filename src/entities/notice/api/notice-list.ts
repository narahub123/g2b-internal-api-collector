import { queryOptions } from '@tanstack/react-query';
import type { NoticeSummary } from '../model/types';

export const noticeListKey = ['notices'] as const;

export const noticeListOptions = queryOptions({
  queryKey: noticeListKey,
  queryFn: async (): Promise<NoticeSummary[]> => {
    const response = await fetch('/api/notices', { cache: 'no-store' });
    if (!response.ok) throw new Error('저장한 공고를 읽지 못했습니다.');
    return response.json();
  },
});
