import { maintenanceResponse } from '@/shared/api/g2b/g2b-maintenance';
import { collectionNumberError } from '@/features/collect-g2b/model/number';
import { collectPriorSpec } from '@/features/collect-g2b/server';

/**
 * 차세대 BD 사전규격등록번호로 상세와 공개 첨부 목록을 다시 조회해 수집이 완료되면 기존 자료를 교체한다.
 * @returns 성공 시 등록번호, 입력 오류는 400, 점검 보류는 503, 그 외 수집 오류는 502를 반환한다.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const numberError = collectionNumberError('prior-specs', number);
  if (numberError) return Response.json({ error: numberError }, { status: 400 });
  try {
    await collectPriorSpec(number, true);
    return Response.json({ number });
  } catch (error) {
    const maintenance = maintenanceResponse(error);
    if (maintenance) return maintenance;
    return Response.json({ error: '나라장터에서 사전규격을 수집하지 못했습니다.' }, { status: 502 });
  }
}
