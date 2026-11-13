import { getG2bRepository } from "@/server/g2b/repository";
import { logNoticeQueueError } from "@/features/collect-g2b/api/notice-queue-service";

/** 영속 중단 사유와 실행 중인 작업 및 최근 작업을 반환한다. */
export function GET() {
  try {
    return Response.json(getG2bRepository().noticeQueue.overview());
  } catch (error) {
    logNoticeQueueError("overview", error);
    return Response.json({ error: "공고 큐 상태를 조회하지 못했습니다." }, { status: 503 });
  }
}

/** 수동 중단 사유만 변경한다. 실행 중인 작업은 계속 처리된다. */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.manual !== "boolean") return Response.json({ error: "중단 상태를 확인하세요." }, { status: 400 });
  try {
    getG2bRepository().noticeQueue.setManual(body.manual);
    return new Response(null, { status: 204 });
  } catch (error) {
    logNoticeQueueError("set-manual", error);
    return Response.json({ error: "공고 큐의 수동 중단 상태를 변경하지 못했습니다." }, { status: 503 });
  }
}
