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
  const repository = getNoticeRepository();
  const documents = notice.documents;
  if (documents?.unavailable?.length || notice.contractRequests === undefined || notice.contracts === undefined) {
    // 일시적인 문서 조회 실패 때문에 이전에 저장한 원본 목록을 잃지 않도록 한다.
    const previous = await repository.find({ number, revision });
    if (documents) {
      for (const kind of documents.unavailable ?? []) {
        documents[kind] = previous?.documents?.[kind];
      }
    }
    notice.contractRequests ??= previous?.contractRequests;
    notice.contracts ??= previous?.contracts;
  }
  await repository.save(notice);
  return Response.json({ number, revision });
}
