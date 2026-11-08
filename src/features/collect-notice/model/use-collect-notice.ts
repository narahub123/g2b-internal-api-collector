import { useMutation, useQueryClient } from '@tanstack/react-query';
import { noticeListKey, type NoticeKey } from '@/entities/notice';
import { submitNotice } from '../api/submit-notice';

export function useCollectNotice(onCollected: (key: NoticeKey) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: submitNotice,
    onSuccess: async (key) => {
      await client.invalidateQueries({ queryKey: noticeListKey });
      onCollected(key);
    },
  });
}
