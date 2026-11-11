'use client';

import { noticePath } from "@/_pages/admin/config/routes";
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { NoticeList, noticeListOptions } from '@/entities/notice';
import { CollectNoticeForm } from '@/features/collect-g2b';

export function NoticesPage() {
  const router = useRouter();
  const notices = useQuery(noticeListOptions);

  return (
    <main className="mx-auto grid max-w-5xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">나라장터 공고 수집</h1>
      <CollectNoticeForm onCollected={(key) => router.push(noticePath(key))} />
      <section aria-labelledby="saved-notices" className="grid gap-3">
        <h2 id="saved-notices" className="text-lg font-semibold">저장된 공고</h2>
        {notices.isPending && <p className="text-sm text-muted-foreground">불러오는 중…</p>}
        {notices.error && <p role="alert" className="text-sm text-destructive">{notices.error.message}</p>}
        {notices.data && <NoticeList notices={notices.data} noticePath={noticePath} />}
      </section>
    </main>
  );
}
