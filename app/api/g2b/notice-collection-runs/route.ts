import { validateNoticePeriod } from "@/features/collect-g2b/api/notice-period";
import { wakeNoticeWorker } from "@/features/collect-g2b/api/notice-actions";
import { logNoticeQueueError } from "@/features/collect-g2b/api/notice-queue-diagnostics";
import { getG2bRepository } from "@/server/g2b/repository";

/** 한국 시각의 기간을 검증하고 워커가 처리할 실행을 영속 접수한다. */
export async function POST(request: Request) {
  // 브라우저의 외부 출처 단순 요청으로 로컬 관리자 수집이 시작되지 않도록 JSON만 받는다.
  const contentType = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return Response.json({ error: "JSON 형식으로 요청해 주세요." }, { status: 415 });
  }
  const body = await request.json().catch(() => null);
  const requestKey = request.headers.get("Idempotency-Key") ?? undefined;
  if (typeof body?.startMinute !== "string" || typeof body.endMinute !== "string" ||
    (requestKey !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(requestKey))) {
    return Response.json({ error: "수집 기간 또는 요청 키 형식을 확인해 주세요." }, { status: 400 });
  }
  const { startMinute, endMinute } = body;
  try {
    validateNoticePeriod(startMinute, endMinute);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return Response.json({ error: error.message }, { status: 400 });
  }
  try {
    const id = await getG2bRepository().noticeQueue.enqueueRun({ startMinute, endMinute }, requestKey);
    await wakeNoticeWorker();
    return Response.json({ id }, { status: 202, headers: { Location: `/api/g2b/notice-collection-runs/${id}` } });
  } catch (error) {
    if (error instanceof RangeError) return Response.json({ error: error.message }, { status: 409 });
    logNoticeQueueError("enqueue-run", error);
    return Response.json({ error: "기간 수집 요청을 접수하지 못했습니다." }, { status: 503 });
  }
}

/** 새로고침 또는 접수 응답 유실 시 복원할 최근 실행을 반환한다. */
export async function GET() {
  try {
    return Response.json((await getG2bRepository().noticeQueue.getRun()) ?? null);
  } catch (error) {
    logNoticeQueueError("get-latest-run", error);
    return Response.json({ error: "최근 기간 수집 상태를 조회하지 못했습니다." }, { status: 503 });
  }
}
