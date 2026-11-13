import { logNoticeQueueError } from "@/features/collect-g2b/api/notice-queue-diagnostics";
import { getG2bRepository } from "@/server/g2b/repository";

/** 접수된 실행의 상태와 소속 공고별 결과를 같은 시점의 집계로 반환한다. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id < 1) return new Response(null, { status: 404 });
  try {
    const run = getG2bRepository().noticeQueue.getRun(id);
    return run ? Response.json(run) : new Response(null, { status: 404 });
  } catch (error) {
    logNoticeQueueError("get-run", error, id);
    return Response.json({ error: "기간 수집 상태를 조회하지 못했습니다." }, { status: 503 });
  }
}
