'use client';

import { noticePath } from "@/_pages/admin/config/routes";
import { useRouter } from 'next/navigation';
import { CollectNoticeForm } from '@/features/collect-g2b';

/**
 * 업무 목록에 공고 수집 폼을 배치하고 수집이 완료되면 공고 상세로 이동한다.
 */
export function NoticeCollectionForm() {
  const router = useRouter();
  return <CollectNoticeForm onCollected={(key) => router.push(noticePath(key))} />;
}
