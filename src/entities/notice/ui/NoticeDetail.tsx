import { decodeHTMLStrict } from 'entities';
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

export function NoticeDetail({ notice }: { notice: Notice }) {
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
      {groups.map(({ title, fields }) => (
        <section key={title} className="grid min-w-0 gap-3 border-t pt-4">
          <h2 className="font-semibold">{title}</h2>
          <dl className="grid gap-4 text-sm">
            {fields.map(({ label, value }) => (
              <div key={label} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <dt className="text-muted-foreground">{label}</dt>
                <dd><NoticeValue value={value} /></dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {tables.map(({ title, columns, rows }) => (
        <section key={title} className="grid min-w-0 gap-3 border-t pt-4">
          <h2 className="font-semibold">{title}</h2>
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
        </section>
      ))}
    </article>
  );
}
