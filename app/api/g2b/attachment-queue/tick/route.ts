import { createHash, timingSafeEqual } from "node:crypto";
import { dispatchPendingAttachments } from "@/features/download-g2b-attachment/server/attachment-actions";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/** 외부 스케줄러 인증 후 남은 첨부를 실행한다. 접수는 202, 실행할 작업이 없으면 204를 반환한다. */
export async function POST(request: Request) {
  const secret = process.env.NOTICE_CRON_TOKEN?.trim();
  if (!secret || process.env.ATTACHMENT_WORKER_MODE !== "github-actions") return new Response(null, { status: 503 });
  if (!timingSafeEqual(digest(request.headers.get("Authorization") ?? ""), digest(`Bearer ${secret}`))) {
    return new Response(null, { status: 401 });
  }
  try {
    return new Response(null, { status: await dispatchPendingAttachments() ? 202 : 204 });
  } catch (error) {
    console.error("[첨부 복구 실행 요청]", error);
    return new Response(null, { status: 503 });
  }
}
