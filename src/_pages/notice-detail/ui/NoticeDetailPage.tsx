import Link from 'next/link';
import type { Notice } from '@/entities/notice';
import { NoticeDetail } from '@/entities/notice/server';
import { Button } from '@/shared/ui/button';

export function NoticeDetailPage({ notice }: { notice: Notice }) {
  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6">
      <Button asChild variant="outline" className="w-fit">
        <Link href="/">목록으로 돌아가기</Link>
      </Button>
      <NoticeDetail notice={notice} />
    </main>
  );
}
