import { contractRequestRevision, type ContractRequestKey } from '@/entities/contract-request/model/contract-request';
import { collectContractRequest } from '@/features/collect-notice/api/g2b';
import { g2bNumber } from '@/shared/model/g2b-number';

export async function POST(_request: Request, { params }: { params: Promise<ContractRequestKey> }) {
  const key = await params;
  if (g2bNumber(key.number) !== key.number || contractRequestRevision(key.revision) !== key.revision) {
    return Response.json({ error: '계약요청접수번호와 차수를 확인하세요.' }, { status: 400 });
  }
  try {
    await collectContractRequest(key, true);
    return Response.json(key);
  } catch {
    return Response.json({ error: '나라장터에서 계약요청 상세와 품목을 수집하지 못했습니다.' }, { status: 502 });
  }
}
