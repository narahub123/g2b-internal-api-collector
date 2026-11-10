import { maintenanceResponse } from '@/shared/api/g2b-maintenance';
import { g2bNumber } from '@/shared/model/g2b-number';
import { collectPriorSpec } from '@/features/collect-notice/api/g2b';

/**
 * 유효한 사전규격등록번호로 상세와 공개 첨부 목록을 다시 조회해 수집이 완료되면 기존 자료를 교체한다.
 * @returns 성공 시 등록번호, 입력 오류는 400, 점검 보류는 503, 그 외 수집 오류는 502를 반환한다.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (g2bNumber(number) !== number) return Response.json({ error: '사전규격등록번호를 확인하세요.' }, { status: 400 });
  try {
    await collectPriorSpec(number, true);
    return Response.json({ number });
  } catch (error) {
    const maintenance = maintenanceResponse(error);
    if (maintenance) return maintenance;
    return Response.json({ error: '나라장터에서 사전규격을 수집하지 못했습니다.' }, { status: 502 });
  }
}
