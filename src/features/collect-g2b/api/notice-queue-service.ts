import { getG2bRepository } from "@/server/g2b/repository";
import type { NoticeQueueInput } from "@/server/g2b/repository/notice-queue-types";
import { logNoticeQueueError } from "./notice-queue-diagnostics";
import { createG2bSession } from "@/shared/api/g2b/g2b-session";
import { collectOrderPlan } from "./order-plans";
import { relatedPlanInputs } from "./collect-and-save-notice";
export { logNoticeQueueError } from "./notice-queue-diagnostics";

/** 접수 결과와 별개로 같은 점검 세대의 종료 여부를 확인한다. */
export async function checkNoticeQueueMaintenance() {
  try {
    const queue = getG2bRepository().noticeQueue;
    const version = await queue.maintenanceVersion();
    if (!version) return;
    try {
      await createG2bSession();
    } catch {
      // 통신 장애와 점검 응답 모두 정상 복귀의 근거가 될 수 없다.
      return;
    }
    await queue.clearMaintenance(version);
  } catch (error) {
    logNoticeQueueError("check-maintenance", error);
  }
}

/** 공고 요청을 영속 접수하고 실제 실행을 조회할 작업 ID를 반환한다. */
export async function acceptNoticeJob(input: NoticeQueueInput, retryAttemptId?: number) {
  let jobId: number;
  try {
    [jobId] = await getG2bRepository().noticeQueue.enqueue([input], true, retryAttemptId);
  } catch (error) {
    logNoticeQueueError("enqueue", error);
    return Response.json({ error: "공고 수집 요청을 접수하지 못했습니다." }, { status: 503 });
  }
  if (jobId === undefined) return Response.json({ error: "최신 수집 이력이 바뀌었습니다." }, { status: 409 });
  await checkNoticeQueueMaintenance();
  return Response.json({ jobId }, { status: 202, headers: { Location: `/api/g2b/notice-queue/jobs/${jobId}` } });
}

/** 발주계획은 저장됐지만 연관 공고의 영속 접수가 실패했음을 전달한다. */
export class QueueRegistrationError extends Error {}

/**
 * 발주계획을 직접 수집하고 저장된 계획에서 발견한 공고를 원자적으로 등록한다.
 * @returns 미존재가 확인되면 큐 등록 없이 요청 번호와 상세 조회 상태를 반환한다.
 * @throws 수집 오류 또는 저장 후 관련 공고를 등록하지 못한 경우의 QueueRegistrationError.
 */
export async function collectPlanAndEnqueueNotices(number: string) {
  await checkNoticeQueueMaintenance();
  const plan = await collectOrderPlan(number, true);
  if (plan.status) return { number: plan.number, status: plan.status };
  try {
    await getG2bRepository().noticeQueue.enqueue(await relatedPlanInputs(plan.number), false);
  } catch (error) {
    logNoticeQueueError("enqueue-plan-notices", error);
    throw new QueueRegistrationError("발주계획은 저장됐지만 관련 공고를 접수하지 못했습니다.", { cause: error });
  }
  return { number: plan.number };
}
