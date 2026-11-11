import { notFound } from "next/navigation";
import { NoticeDetailPage } from "@/_pages/notice-detail";
import type { NoticeKey } from "@/entities/notice";
import { getNoticeRepository } from "@/entities/notice/server";
import { getNoticeOrderPlanNumber } from "@/entities/order-plan/model/order-plan";

export default async function Page({ params }: { params: Promise<NoticeKey> }) {
  const repository = getNoticeRepository();
  const notice = await repository.find(await params);
  if (!notice) notFound();

  const number = getNoticeOrderPlanNumber(notice.payload);
  const orderPlanNumber =
    number && repository.findOrderPlan(number) ? number : undefined;
  return <NoticeDetailPage notice={notice} orderPlanNumber={orderPlanNumber} />;
}
