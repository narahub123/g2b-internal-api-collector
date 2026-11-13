import { setTimeout as delay } from "node:timers/promises";
import { getG2bRepository } from "@/server/g2b/repository";
import { acquireNoticeWorkerLock } from "@/server/g2b/repository/notice-worker-lock";
import type { NoticeAttemptCompletion, NoticeJobOutcome, NoticeQueue, NoticeRunOutcome } from "@/server/g2b/repository/notice-queue-types";
import { withNoticeAttemptCompletions } from "./collection-attempt";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { executeNoticeJob } from "./collect-and-save-notice";
import { checkNoticeQueueMaintenance, logNoticeQueueError } from "./notice-queue-service";
import { listNoticePeriodTargets } from "./notice-period";

async function discoverRun(
  queue: NoticeQueue,
  run: NonNullable<ReturnType<NoticeQueue["claimRun"]>>,
  signal: AbortSignal,
  discover: typeof listNoticePeriodTargets,
) {
  let outcome: NoticeRunOutcome;
  try {
    outcome = { kind: "targets", targets: await discover(run.startMinute, run.endMinute) };
  } catch (error) {
    const maintenance = findMaintenance(error);
    if (!maintenance) logNoticeQueueError("discover-run", error, run.id);
    outcome = maintenance ? { kind: "maintenance", error: maintenance.message } :
      { kind: "failure", error: "기간 내 공고 목록을 확정하지 못했습니다. 같은 기간으로 다시 시도해 주세요." };
  }
  // 결과 기록만 재시도해 일시적인 SQLite 장애가 있어도 외부 목록을 다시 호출하지 않는다.
  while (!signal.aborted) {
    try {
      queue.finishRun(run.id, outcome);
      return;
    } catch (error) {
      logNoticeQueueError("finish-run", error, run.id);
      await delay(1000);
    }
  }
}

/**
 * 단일 워커 실행권을 얻은 뒤 큐를 복구하고 순차 실행한다.
 * 종료 신호가 오면 현재 결과 기록을 마친 뒤 실행권을 반환한다.
 * 단건 실행 예외는 작업 상태에 반영한 뒤 다음 작업을 처리한다.
 * @param execute 선점한 공고의 단건 실행기. 기본값은 실제 수집을 수행한다.
 * @param discover 기간 실행의 최초 대상 탐색기. 기본값은 나라장터 목록을 조회한다.
 */
export async function runNoticeWorker(signal: AbortSignal, execute = executeNoticeJob, discover = listNoticePeriodTargets) {
  const release = acquireNoticeWorkerLock();
  try {
    const queue = getG2bRepository().noticeQueue;
    queue.recover();
    let nextMaintenanceCheck = 0;
    let preferRun = true;
    while (!signal.aborted) {
      let job;
      let run;
      // 선점 결과가 불확실한 경우 다음 반복에서 고아 실행을 복구한 뒤 다시 선점한다.
      try {
        const now = Date.now();
        if (now >= nextMaintenanceCheck && queue.maintenanceVersion() && queue.hasActiveRuns()) {
          await checkNoticeQueueMaintenance();
          nextMaintenanceCheck = Date.now() + 60_000;
        }
        // 기간 탐색이 연속 접수돼도 준비된 상세 작업과 번갈아 처리한다.
        if (preferRun) run = queue.claimRun();
        if (!run) job = queue.claim(now);
        if (!job && !preferRun) run = queue.claimRun();
      } catch (error) {
        logNoticeQueueError("claim", error);
        try {
          queue.recover();
        } catch (recoveryError) {
          logNoticeQueueError("recover-after-claim", recoveryError);
          throw recoveryError;
        }
      }
      if (run) {
        preferRun = false;
        await discoverRun(queue, run, signal, discover);
        continue;
      }
      if (!job) {
        await delay(1000);
        continue;
      }
      preferRun = true;

      let outcome: NoticeJobOutcome;
      const attempts: NoticeAttemptCompletion[] = [];
      try {
        outcome = await withNoticeAttemptCompletions(job.id, attempts, () => execute(job));
      } catch (error) {
        const maintenance = findMaintenance(error);
        if (maintenance) {
          outcome = { kind: "maintenance", error: maintenance.message };
        } else {
          logNoticeQueueError("execute-job", error, job.id);
          outcome = {
            kind: "internal_error",
            error: "공고 수집 중 내부 오류가 발생했습니다. 다시 수집해 주세요.",
          };
        }
      }
      const completedAt = Date.now();
      for (;;) {
        try {
          if (queue.get(job.id)?.status === "running") queue.finish(job.id, outcome, completedAt, attempts);
          break;
        } catch (error) {
          logNoticeQueueError("finish", error, job.id);
          if (signal.aborted) return;
          await delay(1000);
        }
      }
    }
  } finally {
    release();
  }
}
