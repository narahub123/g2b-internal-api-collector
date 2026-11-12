import { getG2bRepository } from "@/server/g2b/repository";
import type { CollectionTarget } from "@/server/g2b/repository/collection-attempts";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";
import { collectionError, collectionStep, describeCollectionError } from "@/shared/api/g2b/collection-diagnostic";

const activeAttempts = new Set<number>();

/**
 * 실제 외부 조회부터 저장까지 한 번의 시도로 기록한다.
 * @param collect 저장까지 수행한다. 계속 진행할 수 있는 부가 조회 실패는 recordFailure로 전달한다.
 * @throws 수집 작업의 원래 오류 또는 수집 이력을 기록하지 못한 경우.
 */
export async function trackCollectionAttempt<Result>(
  target: CollectionTarget,
  collect: (recordFailure: (error: unknown) => void) => Promise<Result>,
) {
  let history: ReturnType<typeof getG2bRepository>["collectionAttempts"];
  let id: number;
  try {
    history = getG2bRepository().collectionAttempts;
    id = history.start(target);
  } catch (error) {
    console.error("[수집 이력 시작 실패]", target.section, target.number,
      describeCollectionError(collectionError(error, { step: "SQLite 수집 이력 시작" })));
    throw error;
  }
  activeAttempts.add(id);
  const partial: unknown[] = [];
  const recordFailure = (error: unknown) => {
    partial.push(error);
  };
  const finishFailure = (error: unknown, errors: unknown[], status: "failed" | "deferred") => {
    const diagnostics = describeCollectionError(errors.length
      ? new AggregateError([...errors, error], "나라장터 수집 중 여러 작업이 실패했습니다.")
      : error);
    try {
      history.finish(id, status, (findMaintenance(error)?.message ?? diagnostics.message)?.slice(0, 300), diagnostics);
    } catch (writeError) {
      console.error("[수집 실패 및 이력 저장 실패]", target.section, target.number, id, diagnostics,
        describeCollectionError(collectionError(writeError, { step: "SQLite 수집 이력 종료" })));
    }
  };
  try {
    let result: Result;
    try {
      result = await collect(recordFailure);
    } catch (error) {
      finishFailure(error, partial, findMaintenance(error) ? "deferred" : "failed");
      throw error;
    }
    if (partial.length) {
      finishFailure(new AggregateError(partial, "일부 나라장터 자료를 수집하지 못했습니다."), [], "failed");
    } else {
      history.finish(id, "succeeded");
    }
    return result;
  } finally {
    activeAttempts.delete(id);
  }
}

/**
 * 기존 자료 조회에 실패한 경우에만 시도 이력을 만들고 실패한 SQLite 작업을 남긴다.
 * @throws 저장소 조회에서 발생한 원래 예외.
 */
export async function trackCollectionLookup<T>(target: CollectionTarget, label: string, read: () => T): Promise<T> {
  try {
    return collectionStep(`SQLite ${label} 조회`, read);
  } catch (error) {
    try {
      await trackCollectionAttempt(target, async () => { throw error; });
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
