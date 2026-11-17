import { logNoticeQueueError } from "@/features/collect-g2b/api/notice-queue-diagnostics";
import type { NoticeAutomaticCursor } from "@/features/collect-g2b/model/notice-automatic";
import { getG2bRepository } from "@/server/g2b/repository";

/** 자동 수집 목록의 한 페이지를 반환한다. 잘못된 목록 종류나 이동 경계는 400으로 응답한다. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const value = params.get("cursor");
  let cursor: NoticeAutomaticCursor | undefined;
  if (value !== null) {
    const match = /^([1-9]\d*)\.(before|after)\.([1-9]\d*)$/.exec(value);
    const walkId = Number(match?.[1]);
    const jobId = Number(match?.[3]);
    if (!match || !Number.isSafeInteger(walkId) || !Number.isSafeInteger(jobId)) {
      return Response.json({ error: "공고 목록의 이동 위치가 올바르지 않습니다." }, { status: 400 });
    }
    cursor = { walkId, jobId, direction: match[2] === "before" ? "before" : "after" };
  }
  if (kind !== "all" && kind !== "failed") {
    return Response.json({ error: "공고 목록 종류를 확인해 주세요." }, { status: 400 });
  }
  try {
    return Response.json(await getG2bRepository().noticeQueue.automatic.list(kind, cursor));
  } catch (error) {
    logNoticeQueueError("automatic-notices", error);
    return Response.json({ error: "자동 수집 공고 목록을 조회하지 못했습니다." }, { status: 503 });
  }
}
