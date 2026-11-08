import { notFound } from 'next/navigation';
import { NoticeDetailPage } from '@/_pages/notice-detail';
import type { NoticeKey } from '@/entities/notice';
import { getNoticeRepository } from '@/entities/notice/server';

export default async function Page({ params }: { params: Promise<NoticeKey> }) {
  const notice = await getNoticeRepository().find(await params);
  if (!notice) notFound();

  return <NoticeDetailPage notice={notice} />;
}
