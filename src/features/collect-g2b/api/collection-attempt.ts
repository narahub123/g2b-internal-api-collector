import { AsyncLocalStorage } from "node:async_hooks";
import { getG2bRepository } from "@/server/g2b/repository";
import type { CollectionTarget } from "@/server/g2b/repository/collection-attempts";
import type { NoticeAttemptCompletion } from "@/server/g2b/repository/notice-queue-types";
import { reportCollectionMaintenance } from "./notice-queue-diagnostics";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { collectionError, collectionAsyncStep, collectionStep, describeCollectionError } from "@/shared/api/g2b/collection-diagnostic";

const activeAttempts = new Set<number>();
// 공고의 병렬 부가 수집도 같은 워커 Job에 연결한다.
const activeNoticeJob = new AsyncLocalStorage<{ id: number; attempts: NoticeAttemptCompletion[] }>();

/** 공고 실행 전체와 부가 수집을 같은 작업에 연결하고 종료 기록을 완료 트랜잭션에 전달한다. */
export function withNoticeAttemptCompletions<T>(id: number, attempts: NoticeAttemptCompletion[], execute: () => Promise<T>) {
  return activeNoticeJob.run({ id, attempts }, execute);
}

/**
 * 실제 외부 조회부터 저장까지 한 번의 시도로 기록한다.
 * @param collect 저장까지 수행한다. 계속 진행할 수 있는 부가 조회 실패는 recordFailure로 전달한다.
 * @param job 공고 워커의 작업 ID와 부분 실패 통지. 내부에서 실행하는 업무별 시도에도 ID를 전달한다.
 * @throws 수집 작업의 원래 오류 또는 수집 이력을 기록하지 못한 경우.
 */
export async function trackCollectionAttempt<Result>(
  target: CollectionTarget,
  collect: (recordFailure: (error: unknown) => void) => Promise<Result>,
  job?: { id: number; onPartialFailure: (error: unknown) => void },
) {
  let history: ReturnType<typeof getG2bRepository>["collectionAttempts"];
  let id: number;
  const context = activeNoticeJob.getStore();
  try {
    history = getG2bRepository().collectionAttempts;
    id = await history.start(target, context?.id ?? job?.id);
  } catch (error) {
    console.error("[수집 이력 시작 실패]", target.section, target.number,
      describeCollectionError(collectionError(error, { step: "저장소 수집 이력 시작" })));
    throw error;
  }
  activeAttempts.add(id);
  const partial: unknown[] = [];
  const recordFailure = (error: unknown) => {
    partial.push(error);
  };
  const finish = async (status: NoticeAttemptCompletion["status"], error: string | null = null,
    diagnostics?: NoticeAttemptCompletion["diagnostics"], attachmentNumber?: string) => {
    if (context) {
      context.attempts.push({ id, status, finishedAt: new Date().toISOString(), error, diagnostics, attachmentNumber });
    } else {
      await history.finish(id, status, error, diagnostics, attachmentNumber);
    }
  };
  const finishFailure = async (error: unknown, errors: unknown[], status: "failed" | "deferred") => {
    if (!job && activeNoticeJob.getStore() === undefined) await reportCollectionMaintenance(error);
    const diagnostics = describeCollectionError(errors.length
      ? new AggregateError([...errors, error], "나라장터 수집 중 여러 작업이 실패했습니다.")
      : error);
    try {
      await finish(status, (findMaintenance(error)?.message ?? diagnostics.message)?.slice(0, 300), diagnostics);
    } catch (writeError) {
      console.error("[수집 실패 및 이력 저장 실패]", target.section, target.number, id, diagnostics,
        describeCollectionError(collectionError(writeError, { step: "저장소 수집 이력 종료" })));
    }
  };
  try {
    let result: Result;
    try {
      result = await collect(recordFailure);
    } catch (error) {
      await finishFailure(error, partial, findMaintenance(error) ? "deferred" : "failed");
      throw error;
    }
    if (partial.length) {
      const error = new AggregateError(partial, "일부 나라장터 자료를 수집하지 못했습니다.");
      await finishFailure(error, [], "failed");
      job?.onPartialFailure(error);
    } else {
      // 공고와 연결된 발주계획은 요청 번호 대신 나라장터가 응답한 번호로 저장될 수 있다.
      const attachmentNumber = target.section === "order-plans" && result && typeof result === "object" &&
        "number" in result && typeof result.number === "string" ? result.number : undefined;
      await finish("succeeded", null, undefined, attachmentNumber);
    }
    return result;
  } finally {
    activeAttempts.delete(id);
  }
}

/**
 * 기존 자료 조회에 실패한 경우에만 시도 이력을 만들고 실패한 저장소 작업을 남긴다.
 * @throws 저장소 조회에서 발생한 원래 예외.
 */
export async function trackCollectionLookup<T>(target: CollectionTarget, label: string, read: () => Promise<T>, jobId?: number): Promise<T> {
  try {
    return await collectionAsyncStep(`저장소 ${label} 조회`, read);
  } catch (error) {
    try {
      await trackCollectionAttempt(target, async () => { throw error; }, jobId === undefined ? undefined : { id: jobId, onPartialFailure: () => {} });
    } catch (historyError) {
      if (historyError !== error) {
        console.error("[조회 실패 및 이력 기록 실패]", target.section, target.number,
          describeCollectionError(error), describeCollectionError(historyError));
      }
    }
    throw error;
  }
}

/**
 * 현재 프로세스가 실행 중인 시도를 확인해 재수집 요청의 중복 실행을 방지한다.
 */
export function isCollectionAttemptActive(id: number): boolean {
  return activeAttempts.has(id);
}
