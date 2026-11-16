import { DetailNavigation } from "@/_pages/admin/g2b/ui/DetailNavigation";
import { CollectionDetailActions } from "@/_pages/admin/g2b/ui/CollectionDetailActions";
import { contractRequestApiPath } from "@/features/collect-g2b/api/routes";
import { notFound } from "next/navigation";
import {
  contractRequestRevision,
  type ContractRequestKey,
} from "@/entities/contract-request/model/contract-request";
import { ContractRequestDetail } from "@/entities/contract-request/ui/ContractRequestDetail";
import { getG2bRepository } from "@/server/g2b/repository";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import { RecollectButton } from "@/features/collect-g2b/ui/RecollectButton";
import { UncollectedBadge } from "@/shared/ui/g2b/UncollectedBadge";

/**
 * 저장된 계약요청과 품목을 표시하고, 미수집 요청에는 최초 수집 동작을 제공한다.
 * @throws 계약요청접수번호와 차수가 정규화된 형식과 일치하지 않으면 404 처리한다. 저장소 조회 오류는 호출자에 전달한다.
 */
export async function ContractRequestDetailPage({
  params,
}: {
  params: Promise<ContractRequestKey>;
}) {
  const key = await params;
  if (
    g2bNumber(key.number) !== key.number ||
    contractRequestRevision(key.revision) !== key.revision
  )
    notFound();
  const contractRequest = await getG2bRepository().findContractRequest(key);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <DetailNavigation section="contract-requests" />
      <h1 className="sr-only">계약요청</h1>
      {contractRequest ? (
        <ContractRequestDetail
          contractRequest={contractRequest}
          actions={
            <CollectionDetailActions section="contract-requests" records={[contractRequest]}>
              <RecollectButton endpoint={contractRequestApiPath(key)} compact />
            </CollectionDetailActions>
          }
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border bg-card p-5">
          <p className="wrap-anywhere">
            계약요청 <UncollectedBadge /> {key.number} / {key.revision}의 상세를 아직 수집하지
            않았습니다.
          </p>
          <RecollectButton endpoint={contractRequestApiPath(key)} initial />
        </div>
      )}
    </div>
  );
}
