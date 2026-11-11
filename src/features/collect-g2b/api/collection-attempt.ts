import { getG2bRepository } from "@/server/g2b/repository";
import type { CollectionTarget } from "@/server/g2b/repository/collection-attempts";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";

const activeAttempts = new Set<number>();

/**
 * 실제 외부 조회부터 저장까지 한 번의 시도로 기록한다.
 * @param collect 저장이 끝난 뒤 완료되며 오류나 점검 상태를 호출자에게 전달하는 수집 작업.
 * @throws 수집 작업의 원래 오류 또는 수집 이력을 기록하지 못한 경우.
 */
export async function trackCollectionAttempt<Result>(target: CollectionTarget, collect: () => Promise<Result>) {
  const history = getG2bRepository().collectionAttempts;
  const id = history.start(target);
  activeAttempts.add(id);
  try {
    let result: Result;
    try {
      result = await collect();
    } catch (error) {
      const maintenance = findMaintenance(error);
      // 파싱 오류에는 원본 응답 일부가 섞일 수 있으므로 사용자용 문구로 대체한다.
      const message = error instanceof Error && !(error instanceof SyntaxError)
        ? error.message.slice(0, 300)
        : "나라장터 데이터를 수집하지 못했습니다.";
      history.finish(id, maintenance ? "deferred" : "failed", maintenance?.message ?? message);
      throw error;
    }
    history.finish(id, "succeeded");
    return result;
  } finally {
    activeAttempts.delete(id);
  }
}

/**
 * 현재 프로세스가 실행 중인 시도를 확인해 재수집 요청의 중복 실행을 방지한다.
 */
export function isCollectionAttemptActive(id: number): boolean {
  return activeAttempts.has(id);
}
