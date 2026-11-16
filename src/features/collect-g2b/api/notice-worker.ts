import { setTimeout as delay } from "node:timers/promises";
import { getG2bDatabase, getG2bRepository } from "@/server/g2b/repository";
import { acquireNoticeWorkerLease } from "@/server/g2b/repository/notice-worker-lease";
import { NoticeWorkerLeaseLostError, withNoticeWorkerToken } from "@/server/g2b/repository/database";
import { noticeRetryDelayMs } from "@/server/g2b/repository/notice-queue-types";
import type { NoticeAttemptCompletion, NoticeJobOutcome, NoticeQueue, NoticeRunOutcome } from "@/server/g2b/repository/notice-queue-types";
import { withNoticeAttemptCompletions } from "./collection-attempt";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { executeNoticeJob } from "./collect-and-save-notice";
import { checkNoticeQueueMaintenance, logNoticeQueueError } from "./notice-queue-service";
import { listNoticePeriodTargets } from "./notice-period";

// 대기 중 새로 접수된 수동 작업도 다음 조회에서 선점한다.
const queuePollMs = 1000;

async function discoverRun(
  queue: NoticeQueue,
  run: NonNullable<Awaited<ReturnType<NoticeQueue["claimRun"]>>>,
  signal: AbortSignal,
  discover: typeof listNoticePeriodTargets,
  failureLimit: number,
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
  for (let failures = 0; !signal.aborted; failures++) {
    try {
      await queue.finishRun(run.id, outcome);
      return;
    } catch (error) {
      if (error instanceof NoticeWorkerLeaseLostError || failures + 1 >= failureLimit) throw error;
      logNoticeQueueError("finish-run", error, run.id);
      await delay(1000);
    }
  }
}

/**
 * 단일 워커 실행권을 얻은 뒤 큐를 복구하고 순차 실행한다.
 * 종료 신호가 오면 현재 결과 기록을 마친 뒤 실행권을 반환한다.
 * 단건 실행 예외는 작업 상태에 반영한 뒤 다음 작업을 처리한다.
 * @throws 실행권 획득·갱신이나 큐 DB 접근을 계속할 수 없는 경우.
 * @param execute 선점한 공고의 단건 실행기. 기본값은 실제 수집을 수행한다.
 * @param discover 기간 실행의 최초 대상 탐색기. 기본값은 나라장터 목록을 조회한다.
 * @param options once 모드는 최대 한 재시도 간격 동안 다음 작업을 기다리며, 저장 오류가 반복되면 실패한다.
 */
export async function runNoticeWorker(
  signal: AbortSignal, execute = executeNoticeJob, discover = listNoticePeriodTargets, { once = false } = {},
) {
  if (signal.aborted) return;
  const lease = await acquireNoticeWorkerLease(getG2bDatabase().client);
  if (!lease) return;

  const heartbeat = new AbortController();
  const lost = new AbortController();
  const stopped = AbortSignal.any([signal, lost.signal]);
  let heartbeatFailure: unknown;
  // 외부 API 응답을 기다리는 동안에도 실행권을 갱신한다.
  const renew = (async () => {
    while (!heartbeat.signal.aborted) {
      try {
        await delay(30_000, undefined, { signal: heartbeat.signal });
        if (!await lease.renew()) {
          lost.abort();
          return;
        }
      } catch (error) {
        if (!heartbeat.signal.aborted) {
          heartbeatFailure = error;
          logNoticeQueueError("renew-worker-lease", error);
          lost.abort();
        }
        return;
      }
    }
  })();

  try {
    await withNoticeWorkerToken(lease.token, () => drainQueue(stopped, execute, discover, once));
  } catch (error) {
    if (once || !(error instanceof NoticeWorkerLeaseLostError)) throw error;
  } finally {
    heartbeat.abort();
    await renew;
    await lease.release();
  }
  if (heartbeatFailure) throw heartbeatFailure;
  if (once && lost.signal.aborted) throw new NoticeWorkerLeaseLostError();
}

async function drainQueue(signal: AbortSignal, execute: typeof executeNoticeJob, discover: typeof listNoticePeriodTargets, once: boolean) {
  const queue = getG2bRepository().noticeQueue;
  if (once) await queue.releaseWorkerDispatch();
  await queue.recover();
  let nextMaintenanceCheck = 0;
  let preferRun = true;
  let claimFailures = 0;
  let idleDeadline: number | undefined;
  const failureLimit = once ? 5 : Infinity;
  while (!signal.aborted) {
    let job;
    let run;
    // 선점 결과가 불확실한 경우 다음 반복에서 고아 실행을 복구한 뒤 다시 선점한다.
    try {
      const now = Date.now();
      const scheduledCheck = await queue.automatic.tick(now);
      if (scheduledCheck) {
        await checkNoticeQueueMaintenance(scheduledCheck);
      } else if (now >= nextMaintenanceCheck && await queue.needsManualMaintenanceCheck()) {
        await checkNoticeQueueMaintenance();
        nextMaintenanceCheck = Date.now() + 60_000;
      }
      const next = await queue.claimNext(now, preferRun);
      if (next?.kind === "run") run = next.run;
      if (next?.kind === "job") job = next.job;
      claimFailures = 0;
    } catch (error) {
      if (error instanceof NoticeWorkerLeaseLostError || ++claimFailures >= failureLimit) throw error;
      logNoticeQueueError("claim", error);
      try {
        await queue.recover();
      } catch (recoveryError) {
        logNoticeQueueError("recover-after-claim", recoveryError);
        throw recoveryError;
      }
      await delay(1000);
      continue;
    }
    if (run) {
      idleDeadline = undefined;
      preferRun = false;
      await discoverRun(queue, run, signal, discover, failureLimit);
      continue;
    }
    if (!job) {
      if (once) {
        const retryAt = await queue.nextRetryAt();
        // 예약 시각이 멀거나 대기 중 연장되면 작업을 큐에 보존하고 다음 정기 호출에 넘긴다.
        // 단조 시계로 대기 한도를 계산해 시스템 시계가 바뀌어도 실행권을 오래 점유하지 않게 한다.
        const elapsedClock = performance.now();
        idleDeadline ??= elapsedClock + noticeRetryDelayMs + queuePollMs;
        if (retryAt === null || retryAt - Date.now() > noticeRetryDelayMs || elapsedClock >= idleDeadline) return;
      }
      await delay(queuePollMs);
      continue;
    }
    idleDeadline = undefined;
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
    for (let failures = 0; ; failures++) {
      try {
        const current = await queue.get(job.id);
        if (current?.status === "running" && current.executions === job.executions) {
          await queue.finish(job.id, outcome, completedAt, attempts);
        }
        break;
      } catch (error) {
        if (error instanceof NoticeWorkerLeaseLostError || failures + 1 >= failureLimit) throw error;
        logNoticeQueueError("finish", error, job.id);
        if (signal.aborted) return;
        await delay(1000);
      }
    }
  }
}
