import { logNoticeQueueError } from "@/features/collect-g2b/api/notice-queue-diagnostics";
import { getG2bRepository } from "@/server/g2b/repository";
import type { NoticeRunCursor } from "@/server/g2b/repository/notice-queue-types";

/** 실행 요약이나 공고 한 페이지를 반환한다. 조회 옵션이 없으면 기존 전체 결과를 반환한다. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id < 1) return new Response(null, { status: 404 });
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind");
  const rawCursor = query.get("cursor");
  let cursor: NoticeRunCursor | undefined;
  if (rawCursor !== null) {
    const match = /^(before|after)\.([1-9]\d*)$/.exec(rawCursor);
    const visitId = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(visitId)) {
      return Response.json({ error: "공고 목록의 이동 위치가 올바르지 않습니다." }, { status: 400 });
    }
    cursor = { direction: match[1] === "before" ? "before" : "after", visitId };
  }
  if (kind !== null && kind !== "all" && kind !== "failed") {
    return Response.json({ error: "공고 목록 종류를 확인해 주세요." }, { status: 400 });
  }
  try {
    const queue = getG2bRepository().noticeQueue;
    const run = kind === "all" || kind === "failed" ? await queue.listRunNotices(id, kind, cursor)
      : query.get("view") === "summary" ? await queue.getRunSummary(id) : await queue.getRun(id);
    return run ? Response.json(run) : new Response(null, { status: 404 });
  } catch (error) {
    logNoticeQueueError("get-run", error, id);
    return Response.json({ error: "기간 수집 상태를 조회하지 못했습니다." }, { status: 503 });
  }
}
