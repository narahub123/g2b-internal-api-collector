import { maintenanceResponse } from '@/shared/api/g2b-maintenance';
import { contractRequestRevision, type ContractRequestKey } from '@/entities/contract-request/model/contract-request';
import { collectContractRequest } from '@/features/collect-notice/api/g2b';
import { g2bNumber } from '@/shared/model/g2b-number';

/**
 * 정규화된 접수번호와 차수로 계약요청 상세와 전체 품목을 다시 수집해 함께 저장한다.
 * @returns 성공 시 식별자, 입력 오류는 400, 점검 보류는 503, 그 외 수집 오류는 502를 반환한다.
 */
export async function POST(_request: Request, { params }: { params: Promise<ContractRequestKey> }) {
  const key = await params;
  if (g2bNumber(key.number) !== key.number || contractRequestRevision(key.revision) !== key.revision) {
    return Response.json({ error: '계약요청접수번호와 차수를 확인하세요.' }, { status: 400 });
  }
  try {
    await collectContractRequest(key, true);
    return Response.json(key);
  } catch (error) {
    const maintenance = maintenanceResponse(error);
    if (maintenance) return maintenance;
    return Response.json({ error: '나라장터에서 계약요청 상세와 품목을 수집하지 못했습니다.' }, { status: 502 });
  }
}
