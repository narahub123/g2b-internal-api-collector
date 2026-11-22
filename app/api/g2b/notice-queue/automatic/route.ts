import { withBusinessAccess } from "@/server/auth/business-access";
import { logNoticeQueueError } from "@/features/collect-g2b/api/notice-queue-diagnostics";
import { wakeNoticeWorker } from "@/features/collect-g2b/api/notice-actions";
import { noticeAutomaticIntervals } from "@/features/collect-g2b/model/notice-automatic";
import { getG2bRepository } from "@/server/g2b/repository";

/** 저장된 자동 수집 설정과 실행 상태를 반환한다. */
async function handleGET() {
  try {
    return Response.json(await getG2bRepository().noticeQueue.automatic.get());
  } catch (error) {
    logNoticeQueueError("automatic-settings", error);
    return Response.json({ error: "자동 수집 설정을 조회하지 못했습니다." }, { status: 503 });
  }
}

/** JSON 관리자 요청으로 시작·재개·중단 또는 주기 변경을 영속 접수한다. */
async function handlePATCH(request: Request) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "JSON 형식으로 요청해 주세요." }, { status: 415 });
  }
  const body = await request.json().catch(() => null);
  const validInterval = noticeAutomaticIntervals.some((interval) => body?.interval === interval);
  if (body?.action !== "stop" && (!validInterval ||
    (body?.action !== "interval" && (body?.action !== "start" || typeof body.startMinute !== "string")))) {
    return Response.json({ error: "자동 수집 작업과 주기를 확인해 주세요." }, { status: 400 });
  }
  try {
    const automatic = getG2bRepository().noticeQueue.automatic;
    await automatic.update(body);
    if (body.action === "start") await wakeNoticeWorker();
    return Response.json(await automatic.get());
  } catch (error) {
    if (error instanceof RangeError) return Response.json({ error: error.message }, { status: 400 });
    logNoticeQueueError("update-automatic", error);
    return Response.json({ error: "자동 수집 설정을 변경하지 못했습니다." }, { status: 503 });
  }
}

// 최신 관리자 권한을 확인한 뒤 운영 기능을 실행한다.
export const GET = withBusinessAccess("ADMIN", handleGET);
// 최신 관리자 권한을 확인한 뒤 운영 기능을 실행한다.
export const PATCH = withBusinessAccess("ADMIN", handlePATCH);
