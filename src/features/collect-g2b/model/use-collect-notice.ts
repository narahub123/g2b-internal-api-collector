import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { noticeListKey, type NoticeKey } from '@/entities/notice';
import { submitNotice } from '../api/submit-notice';

/**
 * 공고 수집 성공 시 목록 캐시를 갱신하고 상세 이동을 요청한다.
 * 실패 시 현재 업무 화면의 수집 이력 집계를 다시 읽는다.
 */
export function useCollectNotice(onCollected: (key: NoticeKey) => void) {
  const client = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: submitNotice,
    onError: () => router.refresh(),
    onSuccess: async (key) => {
      await client.invalidateQueries({ queryKey: noticeListKey });
      onCollected(key);
    },
  });
}
