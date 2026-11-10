import { maintenanceResponse } from '@/shared/api/g2b-maintenance';
import { contractRevision, type ContractKey } from '@/entities/contract/model/contract';
import { collectContract } from '@/features/collect-notice/api/g2b';
import { g2bNumber } from '@/shared/model/g2b-number';

/**
 * 정규화된 계약번호와 변경차수로 계약현황을 다시 조회해 검증된 상세를 저장한다.
 * @returns 성공 시 식별자, 입력 오류는 400, 점검 보류는 503, 그 외 수집 오류는 502를 반환한다.
 */
export async function POST(_request: Request, { params }: { params: Promise<ContractKey> }) {
  const key = await params;
  if (g2bNumber(key.number) !== key.number || contractRevision(key.revision) !== key.revision) {
    return Response.json({ error: '계약번호와 변경차수를 확인하세요.' }, { status: 400 });
  }
  try {
    await collectContract(key, true);
    return Response.json(key);
  } catch (error) {
    const maintenance = maintenanceResponse(error);
    if (maintenance) return maintenance;
    return Response.json({ error: '나라장터에서 계약현황 상세를 수집하지 못했습니다.' }, { status: 502 });
  }
}
