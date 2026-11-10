import { maintenanceResponse } from '@/shared/api/g2b-maintenance';
import { getNoticeRepository } from '@/entities/notice/server';
import { orderPlanAttachmentGroup } from '@/entities/order-plan/model/order-plan';
import { resolvePublicAttachmentDownload } from '@/shared/api/public-attachment-download';

/**
 * 저장된 발주계획에 속한 공개 첨부의 최신 메타데이터를 검증해 다운로드를 허용한다.
 * @returns 검증된 파일은 302, 대상 미확인은 404, 점검은 503, 그 외 메타데이터 조회 실패는 502를 반환한다.
 * @throws 다운로드 대상 조회에 필요한 저장소 접근이 실패한 경우.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ number: string; seq: string }> }) {
  const { number, seq } = await params;
  const plan = getNoticeRepository().findOrderPlan(number);
  if (!plan) return Response.json({ error: '발주계획을 찾을 수 없습니다.' }, { status: 404 });

  try {
    const url = await resolvePublicAttachmentDownload(orderPlanAttachmentGroup(plan), plan.attachments, seq, 'order-plan');
    if (url) return new Response(null, { status: 302, headers: { Location: url.href, 'Cache-Control': 'no-store' } });
    return Response.json({ error: '다운로드 가능한 발주계획 첨부파일을 찾을 수 없습니다.' }, { status: 404 });
  } catch (error) {
    const maintenance = maintenanceResponse(error);
    if (maintenance) return maintenance;
    return Response.json({ error: '나라장터 다운로드 정보를 가져오지 못했습니다.' }, { status: 502 });
  }
}
