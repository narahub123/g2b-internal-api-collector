import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getNoticeRepository } from '@/entities/notice/server';
import { OrderPlanDetail } from '@/entities/order-plan/ui/OrderPlanDetail';
import { Button } from '@/shared/ui/button';

export default async function Page({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const repository = getNoticeRepository();
  const plan = repository.findOrderPlan(number);
  if (!plan) notFound();

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6">
      <Button asChild variant="outline" className="w-fit">
        <Link href="/">목록으로 돌아가기</Link>
      </Button>
      <h1 className="sr-only">발주계획</h1>
      <OrderPlanDetail plan={plan} localNotices={repository.findNoticesForOrderPlan(number)} />
    </main>
  );
}
