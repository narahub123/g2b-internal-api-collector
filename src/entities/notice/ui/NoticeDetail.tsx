import { decodeHTMLStrict } from 'entities';
import Link from 'next/link';
import { orderPlanPath } from '@/entities/order-plan/model/order-plan';
import { Accordion } from '@/shared/ui/accordion';
import { DetailAccordionSection } from '@/shared/ui/detail-accordion-section';
import { renderNoticeHtml } from '../lib/notice-html';
import { getNoticeDisplay } from '../model/notice-display';
import type { Notice } from '../model/types';

function NoticeValue({ value }: { value: string }) {
  const html = renderNoticeHtml(value);
  const className = 'wrap-anywhere overflow-x-auto whitespace-pre-wrap [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5';
  return html === null
    ? <div className={className}>{decodeHTMLStrict(value)}</div>
    : <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * 수집한 공고의 상세 정보와 연결된 문서를 표시한다.
 * @param props 공고와 저장이 확인된 발주계획번호.
 * @returns 공고 상세 본문.
 */
export function NoticeDetail({ notice, orderPlanNumber }: { notice: Notice; orderPlanNumber?: string }) {
  const { groups, tables } = getNoticeDisplay(notice.payload, notice.documents);

  return (
    <article className="grid min-w-0 gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold">{notice.title}</h1>
        <p className="text-sm text-muted-foreground">{notice.number} / {notice.revision}</p>
      </header>
      {notice.documents?.unavailable?.map((kind) => (
        <p key={kind} className="text-sm text-muted-foreground">
          {kind === 'proposal' && notice.documents?.proposalAccessDenied
            ? '나라장터에서 제안요청정보 조회를 거부했습니다(403).'
            : `${kind === 'attachments' ? '파일첨부' : '제안요청정보'}를 가져오지 못했습니다.`}
          {notice.documents?.[kind] && ' 이전에 수집한 목록을 표시합니다.'}
        </p>
      ))}
      <Accordion type="multiple" defaultValue={[...groups, ...tables].map(({ title }) => title)} className="min-w-0 border-t">
        {groups.map(({ title, fields }) => (
          <DetailAccordionSection key={title} title={title}>
            <dl className="grid gap-4 text-sm">
              {fields.map(({ label, value }) => (
                <div key={label} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>
                    {label === '발주계획번호' && orderPlanNumber === value ? (
                      <Link href={orderPlanPath(value)} className="text-primary underline underline-offset-2">{value}</Link>
                    ) : (
                      <>
                        <NoticeValue value={value} />
                        {label === '발주계획번호' && <p className="text-muted-foreground">아직 수집된 발주계획이 없습니다.</p>}
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </DetailAccordionSection>
        ))}
        {tables.map(({ title, columns, rows }) => (
          <DetailAccordionSection key={title} title={title}>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm" aria-label={title}>
                <thead className="bg-secondary">
                  <tr>{columns.map((column) => <th key={column} scope="col" className="px-3 py-2 whitespace-nowrap">{column}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className="border-t align-top">
                      {row.map(({ value, href }, column) => (
                        <td key={columns[column]} className="min-w-20 px-3 py-2">
                          {value === undefined ? '—' : href ? (
                            <a href={href} className="wrap-anywhere text-primary underline underline-offset-2">
                              {decodeHTMLStrict(value)}
                            </a>
                          ) : <NoticeValue value={value} />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DetailAccordionSection>
        ))}
      </Accordion>
    </article>
  );
}
