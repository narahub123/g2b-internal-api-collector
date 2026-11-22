import { businessFetch } from "@/features/service-auth/business-client";
import type { NoticeJob } from "@/server/g2b/repository/notice-queue-types";

/**
 * 접수 응답이면 작업이 끝날 때까지 상태를 조회한다. 기존 동기 응답은 호출자가 처리한다.
 * @throws 작업 실패 또는 상태 조회 실패. 접수된 작업은 관리자 화면에서 다시 확인할 수 있다.
 */
export async function waitForNoticeJob(response: Response, onAccepted: (id: number) => void, signal: AbortSignal) {
  if (response.status !== 202) return;
  const { jobId } = await response.json();
  onAccepted(jobId);
  while (!signal.aborted) {
    const status = await businessFetch(`/api/g2b/notice-queue/jobs/${jobId}`, { signal, cache: "no-store" });
    if (!status.ok) throw new Error(`수집 상태를 확인하지 못했습니다. 공고 수집 큐에서 작업 ${jobId}을 확인하세요.`);
    const job: NoticeJob = await status.json();
    if (job.status === "succeeded") return;
    if (job.status === "failed") {
      throw new Error([
        job.error ?? "공고 수집에 실패했습니다.",
        job.input.opening && job.result?.noticeSaved ? "입찰공고는 저장되어 있습니다." : "",
        job.result?.failedRevisions?.length ? `실패한 개찰차수 ${job.result.failedRevisions.join(", ")}` : "",
      ].filter(Boolean).join(" "));
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  }
  signal.throwIfAborted();
}
