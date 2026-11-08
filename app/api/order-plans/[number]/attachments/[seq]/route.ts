import { getNoticeRepository } from '@/entities/notice/server';
import { orderPlanAttachmentGroup } from '@/entities/order-plan/model/order-plan';
import { resolvePublicAttachmentDownload } from '@/shared/api/public-attachment-download';

export async function GET(_request: Request, { params }: { params: Promise<{ number: string; seq: string }> }) {
  const { number, seq } = await params;
  const plan = getNoticeRepository().findOrderPlan(number);
  if (!plan) return Response.json({ error: '발주계획을 찾을 수 없습니다.' }, { status: 404 });

  try {
    const url = await resolvePublicAttachmentDownload(orderPlanAttachmentGroup(plan), plan.attachments, seq, 'order-plan');
    if (url) return new Response(null, { status: 302, headers: { Location: url.href, 'Cache-Control': 'no-store' } });
    return Response.json({ error: '다운로드 가능한 발주계획 첨부파일을 찾을 수 없습니다.' }, { status: 404 });
  } catch {
    return Response.json({ error: '나라장터 다운로드 정보를 가져오지 못했습니다.' }, { status: 502 });
  }
}
