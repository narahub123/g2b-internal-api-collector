import { DetailNavigation } from "@/_pages/admin/g2b/ui/DetailNavigation";
import { CollectionDetailActions } from "@/_pages/admin/g2b/ui/CollectionDetailActions";
import { noticePath, priorSpecPath } from "@/_pages/admin/config/routes";
import { notFound } from "next/navigation";
import { getG2bRepository } from "@/server/g2b/repository";
import { OrderPlanDetail } from "@/entities/order-plan/ui/OrderPlanDetail";
import { orderPlanNoticeReferences } from "@/entities/order-plan/model/order-plan";
import { g2bNumber } from "@/shared/model/g2b/g2b-number";
import { RecollectButton } from "@/features/collect-g2b/ui/RecollectButton";
import { UncollectedBadge } from "@/shared/ui/g2b/UncollectedBadge";

/**
 * 저장된 발주계획과 연결된 업무를 표시하고, 미수집 계획에는 최초 수집 동작을 제공한다.
 * @throws 발주계획번호가 정규화된 형식과 일치하지 않으면 404 처리한다. 저장소 조회 오류는 호출자에 전달한다.
 */
export async function OrderPlanDetailPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  if (g2bNumber(number) !== number) notFound();
  const repository = getG2bRepository();
  const plan = repository.findOrderPlan(number);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <DetailNavigation section="order-plans" />
      <h1 className="sr-only">발주계획</h1>
      {plan ? (
        <OrderPlanDetail
          plan={plan}
          notices={orderPlanNoticeReferences(plan, repository.findNoticesForOrderPlan(number))}
          noticePath={noticePath}
          priorSpecPath={priorSpecPath}
          actions={
            <CollectionDetailActions section="order-plans" records={[plan]}>
              <RecollectButton endpoint={`/api/order-plans/${encodeURIComponent(number)}`} compact />
            </CollectionDetailActions>
          }
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border bg-card p-5">
          <p className="wrap-anywhere">
            발주계획 <UncollectedBadge /> {number}의 상세를 아직 수집하지 않았습니다.
          </p>
          <RecollectButton
            endpoint={`/api/order-plans/${encodeURIComponent(number)}`}
            initial
          />
        </div>
      )}
    </div>
  );
}
