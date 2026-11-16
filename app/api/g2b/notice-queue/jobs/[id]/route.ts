import { getG2bRepository } from "@/server/g2b/repository";
import { logNoticeQueueError } from "@/features/collect-g2b/api/notice-queue-service";

/** 새로고침이나 워커 재시작 후에도 같은 ID의 수집 상태와 결과를 반환한다. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return new Response(null, { status: 404 });
  try {
    const job = await getG2bRepository().noticeQueue.get(id);
    return job ? Response.json(job) : new Response(null, { status: 404 });
  } catch (error) {
    logNoticeQueueError("get-job", error, id);
    return Response.json({ error: "수집 상태를 조회하지 못했습니다." }, { status: 503 });
  }
}
