import { notFound } from "next/navigation";
import { getG2bRepository } from "@/server/g2b/repository";
import { getNoticeOrderPlanNumber } from "@/entities/order-plan/model/order-plan";
import {
  NOTICE_LIST_PATH,
  contractPath,
  contractRequestPath,
  openingResultPath,
  orderPlanPath,
  priorSpecPath,
} from "@/_pages/admin/config/routes";
import Link from "next/link";
import type { NoticeKey } from "@/entities/notice";
import { NoticeDetail } from "@/entities/notice/ui/NoticeDetail";
import { RecollectButton } from "@/features/collect-g2b/ui/RecollectButton";
import { Button } from "@/shared/ui/button";

/**
 * 저장된 공고와 연결 가능한 발주계획을 조회해 상세 화면을 구성한다.
 * @param props Next.js에서 전달한 공고번호와 차수.
 * @throws 저장된 공고가 없으면 Next.js의 404 처리를 호출하고, 조회 오류는 호출자에 전달한다.
 */
export async function NoticeDetailPage({ params }: { params: Promise<NoticeKey> }) {
  const repository = getG2bRepository();
  const notice = await repository.find(await params);
  if (!notice) notFound();

  const number = getNoticeOrderPlanNumber(notice.payload);
  const orderPlanNumber =
    number && repository.findOrderPlan(number) ? number : undefined;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <Button asChild variant="outline" className="w-fit">
        <Link href={NOTICE_LIST_PATH}>목록으로 돌아가기</Link>
      </Button>
      <NoticeDetail
        notice={notice}
        orderPlanNumber={orderPlanNumber}
        links={{ contractPath, contractRequestPath, openingResultPath, orderPlanPath, priorSpecPath }}
        renderActions={(input) => <RecollectButton endpoint="/api/notices" requestBody={input} compact />}
      />
    </div>
  );
}
