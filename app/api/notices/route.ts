import { collectNotice } from '../../../lib/g2b';
import type { NoticeRepository } from '../../../lib/notice';
import { openNoticeRepository } from '../../../lib/sqlite-notices';

let repository: NoticeRepository | undefined;

export async function GET() {
  repository ??= openNoticeRepository();
  return Response.json(await repository.list());
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  const { number, revision, methodCode } = input ?? {};
  if (typeof number !== 'string' || !/^[A-Z0-9-]{1,30}$/.test(number) ||
      typeof revision !== 'string' || !/^\d{3}$/.test(revision) ||
      typeof methodCode !== 'string' || methodCode.length > 30) {
    return Response.json({ error: '공고번호, 세 자리 차수, 낙찰방법 코드를 확인하세요.' }, { status: 400 });
  }

  const notice = await collectNotice({ number, revision }, methodCode).catch(() => null);
  if (!notice) {
    return Response.json({ error: '나라장터에서 공고 상세를 가져오지 못했습니다.' }, { status: 502 });
  }
  repository ??= openNoticeRepository();
  await repository.save(notice);
  return Response.json({ number, revision });
}
