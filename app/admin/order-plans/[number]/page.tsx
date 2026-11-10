import Link from "next/link";
import { notFound } from "next/navigation";
import { getNoticeRepository } from "@/entities/notice/server";
import { OrderPlanDetail } from "@/entities/order-plan/ui/OrderPlanDetail";
import { g2bNumber } from "@/shared/model/g2b-number";
import { Button } from "@/shared/ui/button";
import { RecollectButton } from "@/shared/ui/recollect-button";

export default async function Page({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  if (g2bNumber(number) !== number) notFound();
  const repository = getNoticeRepository();
  const plan = repository.findOrderPlan(number);

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6">
      <Button asChild variant="outline" className="w-fit">
        <Link href="/admin">목록으로 돌아가기</Link>
      </Button>
      <h1 className="sr-only">발주계획</h1>
      {plan ? (
        <OrderPlanDetail plan={plan} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border bg-card p-5">
          <p className="wrap-anywhere">
            발주계획 {number}의 상세를 아직 수집하지 않았습니다.
          </p>
          <RecollectButton
            endpoint={`/api/order-plans/${encodeURIComponent(number)}`}
            initial
          />
        </div>
      )}
    </main>
  );
}
