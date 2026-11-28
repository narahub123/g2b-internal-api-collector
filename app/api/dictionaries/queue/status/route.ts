import { withBusinessAccess } from "@/server/auth/business-access";
import { getDictionaryQueue } from "@/server/collections/dictionary-queue";
import { getDictionaryCards } from "@/_pages/admin/manage/dictionary-server";

/**
 * 화면에서 접수한 작업의 상태와 원격 수집 완료 후 적용된 카드만 반환한다.
 * @param request 작업 ID가 포함된 관리자 요청.
 * @returns 작업 상태와 완료 시 최신 카드 정보.
 */
async function readStatus(request: Request) {
  const ids = new URL(request.url).searchParams.getAll("id").map(Number);
  if (!ids.length || ids.length > 2 || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    return Response.json({ error: "작업 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const jobs = await getDictionaryQueue().jobs(ids);
  // 큐를 추적하는 동안에는 Blob 카드 조회를 추가하지 않는다.
  const pending = jobs.some(({ status }) => status === "pending" || status === "running" || status === "retry_wait");
  const completed = pending ? [] : jobs.filter(({ status }) => status === "succeeded").map(({ key }) => key);
  const cards = completed.length ? await getDictionaryCards(completed) : undefined;
  return Response.json({ jobs, pending, cards }, { headers: { "Cache-Control": "no-store" } });
}

// 상태와 집계 역시 관리자 요청에서만 조회한다.
export const GET = withBusinessAccess("ADMIN", readStatus);
