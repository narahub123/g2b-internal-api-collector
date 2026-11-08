import { getNoticeRepository } from '@/entities/notice/server';
import type { NoticeKey } from '@/entities/notice/model/types';
import { groupOpeningResultQueries, openingResultQueries } from '@/entities/opening-result/model/opening-result';
import { collectOpeningResult } from '@/features/collect-notice/api/g2b';
import { g2bNumber } from '@/shared/model/g2b-number';

export async function POST(_request: Request, { params }: { params: Promise<NoticeKey> }) {
  const key = await params;
  if (g2bNumber(key.number) !== key.number || !/^\d{3}$/.test(key.revision)) {
    return Response.json({ error: '공고번호와 공고차수를 확인하세요.' }, { status: 400 });
  }
  const repository = getNoticeRepository();
  const notice = await repository.find(key);
  const groups = groupOpeningResultQueries(notice ? openingResultQueries(notice.payload) : []);
  for (const saved of repository.listOpeningResults(key)) {
    if (!groups.has(saved.openingRevision)) groups.set(saved.openingRevision, saved.results.map(({ query }) => query));
  }
  if (!groups.size) return Response.json({ error: '조회할 유찰 상세를 찾을 수 없습니다.' }, { status: 404 });

  try {
    const results = await Promise.allSettled([...groups].map(([openingRevision, queries]) =>
      collectOpeningResult({ ...key, openingRevision }, queries, true)));
    if (results.some((result) => result.status === 'rejected')) {
      return Response.json({ error: '나라장터에서 일부 개찰결과를 수집하지 못했습니다.' }, { status: 502 });
    }
    return Response.json(key);
  } catch {
    return Response.json({ error: '나라장터에서 개찰결과를 수집하지 못했습니다.' }, { status: 502 });
  }
}
