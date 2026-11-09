import Link from 'next/link';
import { notFound } from 'next/navigation';
import { contractPath, contractRevision, type ContractKey } from '@/entities/contract/model/contract';
import { ContractDetail } from '@/entities/contract/ui/ContractDetail';
import { getNoticeRepository } from '@/entities/notice/server';
import { g2bNumber } from '@/shared/model/g2b-number';
import { Button } from '@/shared/ui/button';
import { RecollectButton } from '@/shared/ui/recollect-button';

export default async function Page({ params }: { params: Promise<ContractKey> }) {
  const key = await params;
  if (g2bNumber(key.number) !== key.number || contractRevision(key.revision) !== key.revision) notFound();
  const contract = getNoticeRepository().findContract(key);

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6">
      <Button asChild variant="outline" className="w-fit">
        <Link href="/">목록으로 돌아가기</Link>
      </Button>
      <h1 className="sr-only">계약현황</h1>
      {contract ? <ContractDetail contract={contract} /> : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border bg-card p-5">
          <p className="wrap-anywhere">계약현황 {key.number} / {key.revision}의 상세를 아직 수집하지 않았습니다.</p>
          <RecollectButton endpoint={`/api${contractPath(key)}`} initial />
        </div>
      )}
    </main>
  );
}
