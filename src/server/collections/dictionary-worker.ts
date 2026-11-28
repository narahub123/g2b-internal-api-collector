import { setTimeout as delay } from "node:timers/promises";
import { runIndustryLawCollection } from "./industry-law";
import { runLegalDistrictCollection } from "./legal-districts";
import { getDictionaryQueue, type DictionaryOutcome } from "./dictionary-queue";
import { CollectionBusyError } from "./blob-collection-store";

// 최초 실행과 두 번의 재시도를 처리하되 워크플로 제한 전에 신규 작업을 멈춘다.
const admissionMs = 40 * 60_000;
// 5분 실행권에 여유를 두고 작업 중에만 갱신한다.
const renewalMs = 30_000;
// 기존 공용 수집 함수만 호출해 동일 버전과 0건 처리 정책을 유지한다.
const collectors = { "industry-law": runIndustryLawCollection, "legal-districts": runLegalDistrictCollection };

/**
 * 준비된 사전 작업을 마치고 현재 실행에서 예약한 재시도만 기다린다.
 * @param options 실제 큐 또는 테스트용 실행 의존성.
 * @returns 이 워크플로에서 실패가 발생했는지 여부.
 * @throws 처리 중 종료 신호를 받거나 소유권을 잃으면 만료 복구에 맡긴다.
 */
export async function runDictionaryWorker({
  queue = getDictionaryQueue(), collect = collectors, clock = Date.now, wait = delay, waitForRenewal = delay, signal,
}: {
  /** 기존 사전 큐에 연결되는 저장소. */
  queue?: ReturnType<typeof getDictionaryQueue>;
  /** 사전별 실제 또는 모의 수집 함수. */
  collect?: Record<keyof typeof collectors, (options: { signal: AbortSignal }) => Promise<{ status: string }>>;
  /** 예약 시각을 비교할 UTC 시계. */
  clock?: () => number;
  /** 재시도에 사용하는 중단 가능한 대기 함수. */
  wait?: typeof delay;
  /** 작업 실행권 갱신에 사용하는 중단 가능한 대기 함수. */
  waitForRenewal?: typeof delay;
  /** 강제 종료 전에 추가 선점을 막는 신호. */
  signal?: AbortSignal;
} = {}) {
  // 현재 러너가 생존하는 동안 직접 다시 깨울 수 있는 예약만 추적한다.
  const retries = new Set<number>();
  const deadline = performance.now() + admissionMs;
  let hadFailure = false;
  while (!signal?.aborted && performance.now() < deadline) {
    const job = await queue.claim(clock());
    if (job.kind === "job") {
      retries.delete(job.id);
      // 첨부 워커와 같은 방식으로 갱신 루프의 종료와 실행권 상실을 구분한다.
      const heartbeat = new AbortController();
      const lost = new AbortController();
      const collectionSignal = signal ? AbortSignal.any([signal, lost.signal]) : lost.signal;
      /**
       * 작업이 끝날 때까지 유효한 소유권만 연장하고 갱신 실패를 수집에 전달한다.
       * @param token 이 작업을 선점한 소유권.
       */
      async function renewLease(token: string) {
        try {
          while (!heartbeat.signal.aborted) {
            await waitForRenewal(renewalMs, undefined, { signal: heartbeat.signal });
            if (heartbeat.signal.aborted) return;
            if (!await queue.renew(token, clock())) throw new Error("사전 워커 실행권 상실");
          }
        } catch (error) {
          // 정상적으로 루프를 종료하며 발생한 대기 취소는 수집 실패로 처리하지 않는다.
          if (!heartbeat.signal.aborted) lost.abort(error);
        }
      }
      // 원본 수집과 병렬로 갱신을 시작하되 재시도 대기까지 유지하지 않는다.
      const renewal = renewLease(job.token);
      let outcome: DictionaryOutcome | { retry: boolean };
      try {
        const { status } = await collect[job.key]({ signal: collectionSignal });
        if (status !== "created" && status !== "updated" && status !== "unchanged") throw new Error("알 수 없는 사전 수집 결과");
        outcome = status;
      } catch (error) {
        // 실행권을 잃거나 워커를 중단하면 만료 복구가 결과를 결정한다.
        collectionSignal.throwIfAborted();
        hadFailure = true;
        // 외부 CLI와 Blob 잠금이 충돌해도 자동 작업에는 같은 재시도 한도를 적용한다.
        console.error("[사전 수집 워커]", job.key, error instanceof CollectionBusyError ? "Blob 실행 중" : error);
        outcome = { retry: true };
      } finally {
        // 남아 있는 타이머 또는 갱신 요청을 정리한 뒤 큐 상태를 확정한다.
        heartbeat.abort();
        await renewal;
      }
      // 수집이 취소를 무시하고 반환했더라도 이전 소유자가 완료 처리하지 못하게 한다.
      collectionSignal.throwIfAborted();
      const retryAt = await queue.finish(job.id, job.token, outcome, clock());
      if (retryAt !== undefined) retries.add(job.id);
      continue;
    }
    // finish가 실행권을 돌려준 뒤에만 대기한다. 새 수동 호출은 별도 러너에서 선점할 수 있다.
    const retryAt = await queue.nextRetry([...retries]);
    if (retryAt === undefined) break;
    const remaining = Math.max(0, retryAt - clock());
    const sleep = Math.max(remaining, job.kind === "busy" ? 2_000 : 1);
    if (performance.now() + sleep >= deadline) break;
    await wait(sleep, undefined, { signal }).catch((error: unknown) => {
      if (!signal?.aborted) throw error;
    });
  }
  // 일시 실패 후 성공한 실행도 기존 Actions 기록 정리에서 보존한다.
  return hadFailure;
}
