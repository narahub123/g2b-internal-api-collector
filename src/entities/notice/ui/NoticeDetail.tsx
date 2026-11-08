import type { Notice } from '../model/types';
import { findNoticeHtml, renderNoticeHtml } from '../lib/notice-html';

const summaryFields = [
  ['pbancInstUntyGrpNm', '공고기관'],
  ['dmstUntyGrpNm', '수요기관'],
  ['pbancPstgDt', '게시일'],
  ['slprRcptBgngDt', '입찰서 접수 시작'],
  ['slprRcptDdlnDt', '입찰서 접수 마감'],
  ['onbsPrnmntDt', '개찰 예정'],
  ['stdCtrtMthdNm', '계약 방법'],
  ['scsbdMthdNm', '낙찰 방법'],
  ['prspPrceNm', '추정가격'],
] as const;
const sections = [
  ['bulkPbancGuidCn', '공고 안내'],
  ['bulkBidPrqfGuidCn', '입찰 참가 자격'],
  ['bulkBidPrgrsEtcCn', '입찰 진행'],
  ['bulkScsbdMthdCn', '낙찰 방법'],
  ['bulkPbancScsbdMthdCn', '낙찰자 결정'],
  ['bulkPrplPrsntnEtcCn', '제안서 발표'],
  ['bulkSbmsnDocCn', '제출 서류'],
  ['bulkPbancEtcCn', '기타 안내'],
] as const;

function NoticeValue({ value, html }: { value?: string; html: string | null }) {
  const className = 'wrap-anywhere overflow-x-auto whitespace-pre-wrap [&_a]:text-primary [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5';
  return html === null
    ? <div className={className}>{value}</div>
    : <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function NoticeDetail({ notice }: { notice: Notice }) {
  const detail = notice.payload.dmItemMap as Record<string, unknown> | null;
  const guide = notice.payload.dmItemGuidMap as Record<string, unknown> | null;
  const shownHtml = new Set<string>();
  const summary = summaryFields.flatMap(([key, label]) => {
    const value = detail?.[key];
    if (typeof value !== 'string' || !value.trim()) return [];
    const html = renderNoticeHtml(value);
    if (html) shownHtml.add(html);
    return [{ key, label, value, html }];
  });
  const content = sections.flatMap(([key, label]) => {
    const value = guide?.[key] || detail?.[key];
    if (typeof value !== 'string' || !value.trim()) return [];
    const html = renderNoticeHtml(value);
    if (html) shownHtml.add(html);
    return [{ label, value, html }];
  });
  const additional = [];
  for (const field of findNoticeHtml(notice.payload)) {
    if (shownHtml.has(field.html)) continue;
    shownHtml.add(field.html);
    additional.push(field);
  }

  return (
    <article className="grid min-w-0 gap-5 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold">{notice.title}</h2>
      <p>{notice.number} / {notice.revision} · {new Date(notice.collectedAt).toLocaleString('ko-KR')}</p>
      <dl className="grid gap-3 border-y py-4 text-sm sm:grid-cols-2">
        {summary.map(({ key, label, value, html }) => (
          <div key={key}><dt className="text-muted-foreground">{label}</dt><dd><NoticeValue value={value} html={html} /></dd></div>
        ))}
      </dl>
      {content.length === 0 && additional.length === 0 && <p>이 응답에는 별도 본문 안내 항목이 없습니다. 아래에서 상세 데이터를 확인할 수 있습니다.</p>}
      {content.map(({ label, value, html }) => (
        <section key={label}>
          <h3 className="mb-2 font-semibold">{label}</h3>
          <NoticeValue value={value} html={html} />
        </section>
      ))}
      {additional.length > 0 && (
        <section className="grid gap-3">
          <h3 className="font-semibold">추가 본문 항목</h3>
          {additional.map(({ path, html }) => (
            <div key={path} className="rounded-md border p-3">
              <h4 className="mb-2 wrap-anywhere text-sm font-medium text-muted-foreground">{path}</h4>
              <NoticeValue html={html} />
            </div>
          ))}
        </section>
      )}
      <details className="rounded-md border bg-secondary p-3">
        <summary className="cursor-pointer text-sm font-medium">상세 API 응답 전체</summary>
        <pre className="mt-3 whitespace-pre-wrap wrap-anywhere text-xs">{JSON.stringify(notice.payload, null, 2)}</pre>
      </details>
    </article>
  );
}
