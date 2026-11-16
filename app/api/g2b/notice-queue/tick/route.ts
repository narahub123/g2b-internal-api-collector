import { createHash, timingSafeEqual } from "node:crypto";
import { dispatchNoticeWorker, usesNoticeActions } from "@/features/collect-g2b/api/notice-actions";
import { logNoticeQueueError } from "@/features/collect-g2b/api/notice-queue-diagnostics";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/** cron-job.org의 전용 토큰을 검증한 뒤 실행 가능한 작업이 있으면 Actions를 호출한다. */
export async function POST(request: Request) {
  const secret = process.env.NOTICE_CRON_TOKEN?.trim();
  if (!secret || !usesNoticeActions()) return new Response(null, { status: 503 });
  if (!timingSafeEqual(digest(request.headers.get("Authorization") ?? ""), digest(`Bearer ${secret}`))) {
    return new Response(null, { status: 401 });
  }
  try {
    const result = await dispatchNoticeWorker();
    return new Response(null, { status: result === "dispatched" ? 202 : 204 });
  } catch (error) {
    logNoticeQueueError("cron-dispatch", error);
    return new Response(null, { status: 503 });
  }
}
