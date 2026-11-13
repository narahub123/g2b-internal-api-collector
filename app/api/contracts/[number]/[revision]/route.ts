import { checkNoticeQueueMaintenance } from '@/features/collect-g2b/api/notice-queue-service';
import { maintenanceResponse } from '@/shared/api/g2b/g2b-maintenance';
import { contractRevision, type ContractKey } from '@/entities/contract/model/contract';
import { collectContract } from '@/features/collect-g2b/server';
import { collectionNumberError } from '@/features/collect-g2b/model/number';

/**
 * 차세대 TA 계약번호와 정규화된 변경차수로 계약현황을 다시 조회해 검증된 상세를 저장한다.
 * @returns 성공 시 식별자, 입력 오류는 400, 점검 보류는 503, 그 외 수집 오류는 502를 반환한다.
 */
export async function POST(_request: Request, { params }: { params: Promise<ContractKey> }) {
  const key = await params;
  const numberError = collectionNumberError('contracts', key.number);
  if (numberError) return Response.json({ error: numberError }, { status: 400 });
  if (contractRevision(key.revision) !== key.revision) {
    return Response.json({ error: '변경차수를 확인하세요.' }, { status: 400 });
  }
  await checkNoticeQueueMaintenance();
  try {
    await collectContract(key, true);
    return Response.json(key);
  } catch (error) {
    const maintenance = maintenanceResponse(error);
    if (maintenance) return maintenance;
    return Response.json({ error: '나라장터에서 계약현황 상세를 수집하지 못했습니다.' }, { status: 502 });
  }
}
