import { DetailNavigation } from "@/shared/ui/g2b/DetailNavigation";
import { loadAttachmentPreviewLookup } from "@/_pages/admin/g2b/ui/attachment-preview-data";
import { AttachmentJobsSection } from "@/_pages/admin/g2b/ui/AttachmentJobsSection";
import { CollectionDetailActions } from "@/_pages/admin/g2b/ui/CollectionDetailActions";
import { ADMIN_G2B_PATH, orderPlanPath } from "@/_pages/admin/config/routes";
import { notFound } from "next/navigation";
import { getG2bRepository } from "@/server/g2b/repository";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import { PriorSpecDetail } from "@/entities/prior-spec/ui/PriorSpecDetail";
import { RecollectButton } from "@/features/collect-g2b/ui/RecollectButton";
import { UncollectedBadge } from "@/shared/ui/g2b/UncollectedBadge";

/**
 * 저장된 사전규격과 연결된 발주계획을 표시하고, 미수집 건에는 최초 수집 동작을 제공한다.
 * @throws 사전규격등록번호가 정규화된 형식과 일치하지 않으면 404 처리한다. 저장소 조회 오류는 호출자에 전달한다.
 */
export async function PriorSpecDetailPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  if (g2bNumber(number) !== number) notFound();
  const repository = getG2bRepository();
  const spec = await repository.findPriorSpec(number);
  const previewLookup = spec && await loadAttachmentPreviewLookup({ section: "prior-specs", number, revision: "" });

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      {/* 관리자 상세에서도 공통 이동 버튼으로 해당 관리자 업무 목록에 연결한다. */}
      <DetailNavigation listHref={`${ADMIN_G2B_PATH}/prior-specs`} />
      <h1 className="sr-only">사전규격</h1>
      {spec ? (
        <PriorSpecDetail
          previewLookup={previewLookup || undefined}
          spec={spec}
          orderPlanPath={orderPlanPath}
          actions={
            <CollectionDetailActions section="prior-specs" records={[spec]}>
              <RecollectButton endpoint={`/api/prior-specs/${encodeURIComponent(number)}`} compact />
            </CollectionDetailActions>
          }
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border bg-card p-5">
          <p className="wrap-anywhere">
            사전규격 <UncollectedBadge /> {number}의 상세를 아직 수집하지 않았습니다.
          </p>
          <RecollectButton
            endpoint={`/api/prior-specs/${encodeURIComponent(number)}`}
            initial
          />
        </div>
      )}
      {spec && <AttachmentJobsSection owner={{ section: "prior-specs", number, revision: "" }} />}
    </div>
  );
}
