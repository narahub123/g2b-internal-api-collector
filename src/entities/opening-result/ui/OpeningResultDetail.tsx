import { decodeHTMLStrict } from 'entities';
import type { NoticeKey } from '@/entities/notice/model/types';
import { Accordion } from '@/shared/ui/accordion';
import { DetailAccordionSection } from '@/shared/ui/detail-accordion-section';
import { RecollectButton } from '@/shared/ui/recollect-button';
import { openingResultPath, type OpeningResult } from '../model/opening-result';

/**
 * 개찰차수별로 나라장터 공개 화면의 유찰 메시지와 사유를 표시한다.
 * @param props 공고 식별자, 저장한 개찰결과 목록과 공고 제목.
 * @returns 독립적인 개찰결과 상세 본문.
 */
export function OpeningResultDetail({ noticeKey, results, title }: {
  noticeKey: NoticeKey;
  results: OpeningResult[];
  title?: string;
}) {
  const sections = results.map((result) => ({
    title: results.length === 1 ? '유찰되었습니다.' : `개찰차수 ${result.openingRevision} · 유찰되었습니다.`,
    entries: result.results,
  }));

  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div>
          <h2 className="wrap-anywhere text-xl font-semibold">{title ?? '개찰결과 상세'}</h2>
          <p className="text-sm text-muted-foreground">{noticeKey.number} / {noticeKey.revision}</p>
        </div>
        <RecollectButton endpoint={`/api${openingResultPath(noticeKey)}`} />
      </header>
      <Accordion type="multiple" defaultValue={sections.map((section) => section.title)} className="min-w-0 border-t">
        {sections.map(({ title, entries }) => (
          <DetailAccordionSection key={title} title={title} heading="h3">
            <dl className="grid gap-3 text-sm">
              {entries.map(({ query, detail }) => (
                <div key={query.classification} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">유찰사유</dt>
                  <dd className="wrap-anywhere whitespace-pre-wrap">
                    {typeof detail.prcsRsn === 'string' ? decodeHTMLStrict(detail.prcsRsn) : '—'}
                  </dd>
                </div>
              ))}
            </dl>
          </DetailAccordionSection>
        ))}
      </Accordion>
    </article>
  );
}
