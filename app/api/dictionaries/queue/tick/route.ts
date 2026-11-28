import { createHash, timingSafeEqual } from "node:crypto";
import { dispatchDictionaries } from "@/server/collections/dictionary-dispatch";
import { getDictionaryQueue } from "@/server/collections/dictionary-queue";

/**
 * 정기 호출의 토큰을 고정 길이 해시로 비교할 수 있게 한다.
 * @param value 인증 헤더 또는 기대하는 인증값.
 * @returns 고정 길이 해시.
 */
function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/**
 * 하루 한 번 사전 일정을 접수하고 준비된 큐가 있을 때만 워커를 요청한다.
 * @param request 외부 일정 호출 요청.
 * @returns 실행 요청, 유휴 상태, 인증 거절 또는 장애 응답.
 */
export async function POST(request: Request) {
  const secret = process.env.NOTICE_CRON_TOKEN?.trim();
  if (!secret) return new Response(null, { status: 503 });
  if (!timingSafeEqual(digest(request.headers.get("Authorization") ?? ""), digest(`Bearer ${secret}`))) {
    return new Response(null, { status: 401 });
  }
  try {
    await getDictionaryQueue().tick();
    return new Response(null, { status: await dispatchDictionaries() ? 202 : 204 });
  } catch (error) {
    console.error("[사전 정기 수집]", error);
    return new Response(null, { status: 503 });
  }
}
