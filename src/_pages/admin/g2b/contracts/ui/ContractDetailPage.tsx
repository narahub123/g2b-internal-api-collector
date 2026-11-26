import { DetailNavigation } from "@/shared/ui/g2b/DetailNavigation";
import { ADMIN_G2B_PATH } from "@/_pages/admin/config/routes";
import { CollectionDetailActions } from "@/_pages/admin/g2b/ui/CollectionDetailActions";
import { contractApiPath } from "@/features/collect-g2b/api/routes";
import { notFound } from "next/navigation";
import {
  contractRevision,
  type ContractKey,
} from "@/entities/contract/model/contract";
import { ContractDetail } from "@/entities/contract/ui/ContractDetail";
import { getG2bRepository } from "@/server/g2b/repository";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import { RecollectButton } from "@/features/collect-g2b/ui/RecollectButton";
import { UncollectedBadge } from "@/shared/ui/g2b/UncollectedBadge";

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
  const contract = await getG2bRepository().findContract(key);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      {/* 관리자 상세에서도 공통 이동 버튼으로 해당 관리자 업무 목록에 연결한다. */}
      <DetailNavigation listHref={`${ADMIN_G2B_PATH}/contracts`} />
      <h1 className="sr-only">계약현황</h1>
      {contract ? (
        <ContractDetail
          contract={contract}
          actions={
            <CollectionDetailActions section="contracts" records={[contract]}>
              <RecollectButton endpoint={contractApiPath(key)} compact />
            </CollectionDetailActions>
          }
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border bg-card p-5">
          <p className="wrap-anywhere">
            계약현황 <UncollectedBadge /> {key.number} / {key.revision}의 상세를 아직 수집하지
            않았습니다.
          </p>
          <RecollectButton endpoint={contractApiPath(key)} initial />
        </div>
      )}
    </div>
  );
}
