import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";

// 동일 프로세스에서 같은 대상의 중복 수집을 공유한다. 영구적인 작업 큐나 DB 잠금은 아니다.
const pendingCollections = new Map<
  string,
  { force: boolean; promise: Promise<void> }
>();

/**
 * 동일 수집 대상의 진행 중 작업을 재사용하고 완료 후 공유 상태를 해제한다.
 * 강제 재수집은 진행 중인 일반 수집이 끝난 뒤 새로 실행해 요청이 생략되지 않게 한다.
 * 일반 수집에서 점검이 확인되면 대기 중인 강제 재수집도 보류한다.
 *
 * @param key 수집 대상 식별자.
 * @param force 기존 저장 여부와 무관한 강제 재수집 여부.
 * @param collect 실제 수집 작업.
 * @returns 실행 중이거나 새로 시작한 수집 작업의 Promise.
 */
export async function collectOnce(
  key: string,
  force: boolean,
  collect: () => Promise<void>,
) {
  const pending = pendingCollections.get(key);
  if (pending) {
    if (!force || pending.force) return pending.promise;
    // 일반 수집은 저장된 자료를 건너뛸 수 있다. 점검이 없을 때만 대기하던 강제 수집을 새로 실행한다.
    await pending.promise.catch((error: unknown) => {
      const maintenance = findMaintenance(error);
      if (maintenance) throw maintenance;
    });
    return collectOnce(key, force, collect);
  }
  const promise = collect().finally(() => pendingCollections.delete(key));
  pendingCollections.set(key, { force, promise });
  return promise;
}
