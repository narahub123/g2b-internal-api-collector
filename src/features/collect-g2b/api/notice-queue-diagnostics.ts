import { getG2bRepository } from "@/server/g2b/repository";
import { describeCollectionError } from "@/shared/api/g2b/collection-diagnostic";
import { findMaintenance } from "@/shared/api/g2b/g2b-maintenance";

/** DB 장애 중에도 기존 진단 형식의 운영 로그를 프로세스 표준 오류에 기록한다. */
export function logNoticeQueueError(operation: string, error: unknown, jobId?: number) {
  console.error(JSON.stringify({
    time: new Date().toISOString(), component: "notice-queue", operation, jobId,
    diagnostic: describeCollectionError(error),
  }));
}

/** 업무 수집에서 확인된 점검을 큐에 전파하고 저장 실패는 운영 로그에 남긴다. */
export async function reportCollectionMaintenance(error: unknown) {
  if (!findMaintenance(error)) return;
  try {
    await getG2bRepository().noticeQueue.markMaintenance();
  } catch (writeError) {
    logNoticeQueueError("mark-maintenance", writeError);
  }
}
