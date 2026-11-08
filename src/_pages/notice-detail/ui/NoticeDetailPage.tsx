import Link from 'next/link';
import type { Notice } from '@/entities/notice';
import { NoticeDetail } from '@/entities/notice/server';
import { Button } from '@/shared/ui/button';

/**
 * 공고 상세를 목록으로 돌아가는 탐색 링크와 함께 표시한다.
 * @param props 공고와 저장이 확인된 발주계획번호.
 * @returns 공고 상세 페이지.
 */
export function NoticeDetailPage({ notice, orderPlanNumber }: { notice: Notice; orderPlanNumber?: string }) {
  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6">
      <Button asChild variant="outline" className="w-fit">
        <Link href="/">목록으로 돌아가기</Link>
      </Button>
      <NoticeDetail notice={notice} orderPlanNumber={orderPlanNumber} />
    </main>
  );
}
