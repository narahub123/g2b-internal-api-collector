import Link from 'next/link';
import { notFound } from 'next/navigation';
import { noticePath } from '@/entities/notice/lib/notice-path';
import type { NoticeKey } from '@/entities/notice/model/types';
import { getNoticeRepository } from '@/entities/notice/server';
import { openingResultPath, openingResultQueries } from '@/entities/opening-result/model/opening-result';
import { OpeningResultDetail } from '@/entities/opening-result/ui/OpeningResultDetail';
import { g2bNumber } from '@/shared/model/g2b-number';
import { Button } from '@/shared/ui/button';
import { RecollectButton } from '@/shared/ui/recollect-button';

export default async function Page({ params }: { params: Promise<NoticeKey> }) {
  const key = await params;
  if (g2bNumber(key.number) !== key.number || !/^\d{3}$/.test(key.revision)) notFound();
  const repository = getNoticeRepository();
  const notice = await repository.find(key);
  const results = repository.listOpeningResults(key);
  if (!results.length && (!notice || !openingResultQueries(notice.payload).length)) notFound();

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6">
      <Button asChild variant="outline" className="w-fit">
        <Link href={notice ? noticePath(key) : '/'}>{notice ? '입찰공고로 돌아가기' : '목록으로 돌아가기'}</Link>
      </Button>
      <h1 className="sr-only">개찰결과</h1>
      {results.length ? <OpeningResultDetail noticeKey={key} results={results} title={notice?.title} /> : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border bg-card p-5">
          <p className="wrap-anywhere">이 공고의 유찰 상세를 아직 수집하지 않았습니다.</p>
          <RecollectButton endpoint={`/api${openingResultPath(key)}`} initial />
        </div>
      )}
    </main>
  );
}
