'use client';

import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import sanitizeHtml from 'sanitize-html';
import type { Notice, NoticeKey } from '../lib/notice';

const queryKey = ['notices'];
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

async function readNotices(): Promise<Notice[]> {
  const response = await fetch('/api/notices', { cache: 'no-store' });
  if (!response.ok) throw new Error('저장한 공고를 읽지 못했습니다.');
  return response.json();
}

async function saveNotice(input: NoticeKey & { methodCode: string }): Promise<NoticeKey> {
  const response = await fetch('/api/notices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? '수집 중 오류가 발생했습니다.');
  return data;
}

function NoticeDetail({ notice }: { notice: Notice }) {
  const detail = notice.payload.dmItemMap as Record<string, unknown>;
  const guide = notice.payload.dmItemGuidMap as Record<string, unknown> | null;
  const content = sections.flatMap(([key, label]) => {
    const value = guide?.[key] || detail[key];
    return typeof value === 'string' && value.trim() ? [{ label, value }] : [];
  });

  return (
    <article>
      <h2>{notice.title}</h2>
      <p>{notice.number} / {notice.revision} · {new Date(notice.collectedAt).toLocaleString('ko-KR')}</p>
      <dl>
        {summaryFields.map(([key, label]) => {
          const value = detail[key];
          if (typeof value !== 'string' || !value.trim()) return null;
          return <div key={key}><dt>{label}</dt><dd>{value}</dd></div>;
        })}
      </dl>
      {content.length === 0 && <p>이 응답에는 별도 본문 안내 항목이 없습니다. 아래에서 상세 데이터를 확인할 수 있습니다.</p>}
      {content.map(({ label, value }) => (
        <section key={label}>
          <h3>{label}</h3>
          <div style={{ whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }} />
        </section>
      ))}
      <details>
        <summary>상세 API 응답 전체</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(notice.payload, null, 2)}</pre>
      </details>
    </article>
  );
}

function Collector() {
  const [selected, setSelected] = useState<NoticeKey>();
  const client = useQueryClient();
  const notices = useQuery({ queryKey, queryFn: readNotices });
  const collection = useMutation({
    mutationFn: saveNotice,
    onSuccess: async (key) => {
      await client.invalidateQueries({ queryKey });
      setSelected(key);
    },
  });
  const current = selected
    ? notices.data?.find(({ number, revision }) => number === selected.number && revision === selected.revision)
    : notices.data?.[0];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    collection.mutate({
      number: String(fields.get('number')).trim().toUpperCase(),
      revision: String(fields.get('revision')).trim().padStart(3, '0'),
      methodCode: String(fields.get('methodCode')).trim(),
    });
  }

  return (
    <main style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui' }}>
      <h1>나라장터 공고 수집</h1>
      <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        <label>공고번호 <input name="number" required maxLength={30} /></label>
        <label>차수 <input name="revision" required inputMode="numeric" pattern="[0-9]{1,3}" defaultValue="000" /></label>
        <label>낙찰방법 코드 <input name="methodCode" maxLength={30} /></label>
        <button disabled={collection.isPending}>{collection.isPending ? '수집 중…' : '수집 / 다시 수집'}</button>
      </form>
      {collection.error && <p role="alert">{collection.error.message}</p>}
      <h2>저장된 공고</h2>
      {notices.isPending && <p>불러오는 중…</p>}
      {notices.error && <p role="alert">{notices.error.message}</p>}
      {notices.data?.length === 0 && <p>저장된 공고가 없습니다.</p>}
      <ul>
        {notices.data?.map((notice) => (
          <li key={`${notice.number}/${notice.revision}`}>
            <button onClick={() => setSelected(notice)} aria-pressed={current === notice}>
              {notice.title} ({notice.number}/{notice.revision})
            </button>
          </li>
        ))}
      </ul>
      {current && <NoticeDetail notice={current} />}
    </main>
  );
}

export default function Home() {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><Collector /></QueryClientProvider>;
}
