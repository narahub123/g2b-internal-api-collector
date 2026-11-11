import { NOTICE_LIST_PATH } from "@/_pages/admin/config/routes";
import { contractApiPath } from "@/features/collect-g2b/api/routes";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  contractRevision,
  type ContractKey,
} from "@/entities/contract/model/contract";
import { ContractDetail } from "@/entities/contract/ui/ContractDetail";
import { getG2bRepository } from "@/server/g2b/repository";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import { Button } from "@/shared/ui/button";
import { RecollectButton } from "@/features/collect-g2b/ui/RecollectButton";

/**
 * 저장된 계약현황을 표시하고, 미수집 계약에는 최초 수집 동작을 제공한다.
 * @throws 계약번호와 변경차수가 정규화된 형식과 일치하지 않으면 404 처리한다. 저장소 조회 오류는 호출자에 전달한다.
 */
export async function ContractDetailPage({
  params,
}: {
  params: Promise<ContractKey>;
}) {
  const key = await params;
  if (
    g2bNumber(key.number) !== key.number ||
    contractRevision(key.revision) !== key.revision
  )
    notFound();
  const contract = getG2bRepository().findContract(key);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <Button asChild variant="outline" className="w-fit">
        <Link href={NOTICE_LIST_PATH}>목록으로 돌아가기</Link>
      </Button>
      <h1 className="sr-only">계약현황</h1>
      {contract ? (
        <ContractDetail
          contract={contract}
          actions={<RecollectButton endpoint={contractApiPath(key)} compact />}
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border bg-card p-5">
          <p className="wrap-anywhere">
            계약현황 {key.number} / {key.revision}의 상세를 아직 수집하지
            않았습니다.
          </p>
          <RecollectButton endpoint={contractApiPath(key)} initial />
        </div>
      )}
    </div>
  );
}
