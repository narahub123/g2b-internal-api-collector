import { DetailNavigation } from "@/_pages/admin/g2b/ui/DetailNavigation";
import { notFound } from "next/navigation";
import { getG2bRepository } from "@/server/g2b/repository";
import { getNoticeOrderPlanNumber } from "@/entities/order-plan/model/order-plan";
import {
  contractPath,
  contractRequestPath,
  noticePath,
  openingResultPath,
  orderPlanPath,
  priorSpecPath,
} from "@/_pages/admin/config/routes";
import type { NoticeKey } from "@/entities/notice";
import { NoticeDetail } from "@/entities/notice/ui/NoticeDetail";
import { RecollectButton } from "@/features/collect-g2b/ui/RecollectButton";
import { noticeRunJobLabels } from "@/_pages/admin/g2b/ui/notice-run-status";
import { CollectionFailureDetails } from "@/_pages/admin/g2b/ui/CollectionFailureDetails";

/**
 * 저장된 공고와 연결 가능한 발주계획을 조회하고 관리자 상세 경로를 본문에 전달한다.
 * @param props Next.js에서 전달한 공고번호와 차수.
 * 기간 수집에만 등록된 공고는 식별 정보와 최근 수집 상태를 표시한다.
 * @throws 저장 상세와 기간 수집 기록이 모두 없으면 404를 반환하고, 조회 오류는 호출자에 전달한다.
 */
export async function NoticeDetailPage({ params }: { params: Promise<NoticeKey> }) {
  const repository = getG2bRepository();
  const key = await params;
  const notice = await repository.find(key);
  const failure = repository.collectionAttempts.latestNoticeFailure(key.number, key.revision);
  if (!notice) {
    const target = repository.noticeQueue.findRunNotice(key.number, key.revision);
    if (!target) notFound();
    return (
      <div className="grid min-w-0 gap-6">
        <DetailNavigation section="notices" />
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h1 className="text-xl font-semibold">{target.title || "공고명 미확인"}</h1>
          <p className="text-sm">공고번호 {target.number} · 차수 {target.revision}</p>
          <p className="text-sm">수집 상태 {noticeRunJobLabels[target.status]}</p>
          {target.status === "failed" && (
            <>
              {(failure?.error || target.error) && (
                <p className="text-sm text-destructive">{failure?.error || target.error}</p>
              )}
              {failure?.diagnostics && <CollectionFailureDetails diagnostics={failure.diagnostics} />}
              <RecollectButton endpoint="/api/notices" requestBody={{ ...key, methodCode: target.methodCode }} refreshOnError />
            </>
          )}
        </section>
      </div>
    );
  }

  const number = notice.orderPlanNumber ?? getNoticeOrderPlanNumber(notice.payload);
  const orderPlanNumber =
    number && repository.findOrderPlan(number) ? number : undefined;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <DetailNavigation section="notices" />
      {failure && (
        <section aria-label="최근 수집 실패" className="rounded-lg border bg-card p-4">
          <p className="text-sm text-destructive">{failure.error || "최근 수집에 실패했습니다."}</p>
          {failure.diagnostics && <CollectionFailureDetails diagnostics={failure.diagnostics} />}
        </section>
      )}
      <NoticeDetail
        notice={notice}
        orderPlanNumber={orderPlanNumber}
        links={{
          contractPath,
          contractRequestPath,
          noticePath: (key) => repository.findUsableNotice(key) ? noticePath(key) : undefined,
          openingResultPath,
          orderPlanPath,
          priorSpecPath,
        }}
        renderActions={(input) => <RecollectButton endpoint="/api/notices" requestBody={input} compact refreshOnError />}
      />
    </div>
  );
}
