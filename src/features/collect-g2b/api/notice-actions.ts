import { getG2bRepository } from "@/server/g2b/repository";
import { logNoticeQueueError } from "./notice-queue-diagnostics";

/** 배포 서버에서만 GitHub Actions 호출을 활성화한다. */
export function usesNoticeActions() {
  return process.env.NOTICE_WORKER_MODE === "github-actions";
}

/**
 * Turso가 실행을 예약한 경우 공고 워크플로를 호출한다.
 * @returns 로컬 모드, 호출할 작업 없음, 또는 GitHub가 접수한 상태.
 * @throws 배포 설정 오류 또는 호출 실패. 기존 큐 접수는 유지하며 예약을 해제한다.
 */
export async function dispatchNoticeWorker() {
  if (!usesNoticeActions()) return "local";
  const repository = process.env.NOTICE_GITHUB_REPOSITORY?.trim();
  const ref = process.env.NOTICE_GITHUB_REF?.trim();
  const credential = process.env.NOTICE_GITHUB_TOKEN?.trim();
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !ref || !credential) {
    throw new Error("공고 수집 Actions 배포 설정을 확인해 주세요.");
  }

  const queue = getG2bRepository().noticeQueue;
  const reservation = await queue.reserveWorkerDispatch(Date.now());
  if (!reservation) return "idle";
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/notice-collection.yml/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body: JSON.stringify({ ref }),
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`공고 수집 Actions 호출 실패 (HTTP ${response.status})`);
    return "dispatched";
  } catch (error) {
    try {
      await queue.releaseWorkerDispatch(reservation);
    } catch (releaseError) {
      logNoticeQueueError("release-dispatch", releaseError);
    }
    throw error;
  }
}

/** 영속 접수 뒤 즉시 실행을 시도한다. 실패하면 정기 호출이 큐를 복구할 수 있도록 상세를 서버에 기록한다. */
export async function wakeNoticeWorker() {
  try {
    await dispatchNoticeWorker();
  } catch (error) {
    logNoticeQueueError("dispatch-worker", error);
  }
}
