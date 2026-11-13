import { setTimeout as delay } from "node:timers/promises";
import { getG2bRepository } from "@/server/g2b/repository";
import { acquireNoticeWorkerLock } from "@/server/g2b/repository/notice-worker-lock";
import type { NoticeAttemptCompletion, NoticeJobOutcome } from "@/server/g2b/repository/notice-queue-types";
import { withNoticeAttemptCompletions } from "./collection-attempt";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { executeNoticeJob } from "./collect-and-save-notice";
import { logNoticeQueueError } from "./notice-queue-service";

/**
 * 단일 워커 실행권을 얻은 뒤 큐를 복구하고 순차 실행한다.
 * 종료 신호가 오면 현재 결과 기록을 마친 뒤 실행권을 반환한다.
 * 단건 실행 예외는 작업 상태에 반영한 뒤 다음 작업을 처리한다.
 * @param execute 선점한 공고의 단건 실행기. 기본값은 실제 수집을 수행한다.
 */
export async function runNoticeWorker(signal: AbortSignal, execute = executeNoticeJob) {
  const release = acquireNoticeWorkerLock();
  try {
    const queue = getG2bRepository().noticeQueue;
    queue.recover();
    while (!signal.aborted) {
      let job;
      // 선점 결과가 불확실한 경우 다음 반복에서 고아 실행을 복구한 뒤 다시 선점한다.
      try {
        job = queue.claim(Date.now());
      } catch (error) {
        logNoticeQueueError("claim", error);
        try {
          queue.recover();
        } catch (recoveryError) {
          logNoticeQueueError("recover-after-claim", recoveryError);
          throw recoveryError;
        }
      }
      if (!job) {
        await delay(1000);
        continue;
      }

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
