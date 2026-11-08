import { g2bNumber } from '@/shared/model/g2b-number';
import { collectPriorSpec } from '@/features/collect-notice/api/g2b';

export async function POST(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (g2bNumber(number) !== number) return Response.json({ error: '사전규격등록번호를 확인하세요.' }, { status: 400 });
  try {
    await collectPriorSpec(number, true);
    return Response.json({ number });
  } catch {
    return Response.json({ error: '나라장터에서 사전규격을 수집하지 못했습니다.' }, { status: 502 });
  }
}
