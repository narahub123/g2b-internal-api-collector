import { getNoticeRepository } from '@/entities/notice/server';
import { collectNotice, parseCollectNoticeInput } from '@/features/collect-notice/server';

export async function GET() {
  return Response.json(await getNoticeRepository().list());
}

export async function POST(request: Request) {
  const input = parseCollectNoticeInput(await request.json().catch(() => null));
  if (!input) {
    return Response.json({ error: '공고번호, 세 자리 차수, 낙찰방법 코드를 확인하세요.' }, { status: 400 });
  }

  const { number, revision, methodCode } = input;
  const notice = await collectNotice({ number, revision }, methodCode).catch(() => null);
  if (!notice) {
    return Response.json({ error: '나라장터에서 공고 상세를 가져오지 못했습니다.' }, { status: 502 });
  }
  await getNoticeRepository().save(notice);
  return Response.json({ number, revision });
}
