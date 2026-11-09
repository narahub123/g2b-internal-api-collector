import { contractRevision, type ContractKey } from '@/entities/contract/model/contract';
import { collectContract } from '@/features/collect-notice/api/g2b';
import { g2bNumber } from '@/shared/model/g2b-number';

export async function POST(_request: Request, { params }: { params: Promise<ContractKey> }) {
  const key = await params;
  if (g2bNumber(key.number) !== key.number || contractRevision(key.revision) !== key.revision) {
    return Response.json({ error: '계약번호와 변경차수를 확인하세요.' }, { status: 400 });
  }
  try {
    await collectContract(key, true);
    return Response.json(key);
  } catch {
    return Response.json({ error: '나라장터에서 계약현황 상세를 수집하지 못했습니다.' }, { status: 502 });
  }
}
