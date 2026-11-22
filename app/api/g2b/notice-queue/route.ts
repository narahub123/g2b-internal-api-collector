import { withBusinessAccess } from "@/server/auth/business-access";
import { getG2bRepository } from "@/server/g2b/repository";
import { wakeNoticeWorker } from "@/features/collect-g2b/api/notice-actions";
import { logNoticeQueueError } from "@/features/collect-g2b/api/notice-queue-service";

/** 큐 요약 또는 작업 한 페이지를 반환한다. 옵션이 없으면 기존 최근 작업을 반환한다. */
async function handleGET(request?: Request) {
  const query = request && new URL(request.url).searchParams;
  const rawPage = query?.get("page");
  const page = Number(rawPage);
  const kind = query?.get("kind");
  if (rawPage != null && kind != null && kind !== "all" && kind !== "failed") {
    return Response.json({ error: "공고 목록 종류를 확인해 주세요." }, { status: 400 });
  }
  if (rawPage != null && (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page))) {
    return Response.json({ error: "페이지 번호를 확인해 주세요." }, { status: 400 });
  }
  try {
    const queue = getG2bRepository().noticeQueue;
    const result = rawPage != null ? await queue.getQueuePage(page, kind === "failed" ? "failed" : "all")
      : query?.get("view") === "summary" ? await queue.getQueueSummary() : await queue.overview();
    return Response.json(result);
  } catch (error) {
    logNoticeQueueError("overview", error);
    return Response.json({ error: "공고 큐 상태를 조회하지 못했습니다." }, { status: 503 });
  }
}

/** 수동 중단 사유만 변경한다. 실행 중인 작업은 계속 처리된다. */
async function handlePATCH(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.manual !== "boolean") return Response.json({ error: "중단 상태를 확인하세요." }, { status: 400 });
  try {
    await getG2bRepository().noticeQueue.setManual(body.manual);
    if (!body.manual) await wakeNoticeWorker();
    return new Response(null, { status: 204 });
  } catch (error) {
    logNoticeQueueError("set-manual", error);
    return Response.json({ error: "공고 큐의 수동 중단 상태를 변경하지 못했습니다." }, { status: 503 });
  }
}

// 최신 관리자 권한을 확인한 뒤 운영 기능을 실행한다.
export const GET = withBusinessAccess("ADMIN", handleGET);
// 최신 관리자 권한을 확인한 뒤 운영 기능을 실행한다.
export const PATCH = withBusinessAccess("ADMIN", handlePATCH);
