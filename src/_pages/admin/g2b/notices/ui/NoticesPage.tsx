'use client';

import { noticePath } from "@/_pages/admin/config/routes";
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { NoticeList, noticeListOptions } from '@/entities/notice';
import { CollectNoticeForm } from '@/features/collect-g2b';

/**
 * 공고 수집 폼과 저장 목록을 표시하고, 수집이 완료되면 해당 공고 상세로 이동한다.
 */
export function NoticesPage() {
  const router = useRouter();
  const notices = useQuery(noticeListOptions);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <h1 className="text-2xl font-semibold">나라장터 공고 수집</h1>
      <CollectNoticeForm onCollected={(key) => router.push(noticePath(key))} />
      <section aria-labelledby="saved-notices" className="grid gap-3">
        <h2 id="saved-notices" className="text-lg font-semibold">저장된 공고</h2>
        {notices.isPending && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
        {notices.error && <p role="alert" className="text-sm text-destructive">{notices.error.message}</p>}
        {notices.data && <NoticeList notices={notices.data} noticePath={noticePath} />}
      </section>
    </div>
  );
}
