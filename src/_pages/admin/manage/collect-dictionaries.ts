"use server";

import { revalidatePath } from "next/cache";
import { checkAdminAction } from "@/server/auth/business-access";
import { dispatchDictionaries } from "@/server/collections/dictionary-dispatch";
import { getDictionaryQueue } from "@/server/collections/dictionary-queue";
import { ADMIN_DICTIONARIES_PATH } from "../config/routes";
import { dictionaries } from "./dictionaries";
import { isDictionaryId } from "./dictionary-server";

/**
 * 관리자 권한을 검증한 뒤 사전 하나 또는 전체를 수동 큐에 접수한다.
 * @param target 전체 수집 또는 등록된 사전 식별자.
 * @returns 접수된 작업 ID 또는 사용자에게 보여줄 오류.
 */
export async function collectDictionaries(target: unknown) {
  const failure = await checkAdminAction();
  if (failure) return { error: failure.error, ids: [] };
  if (target !== "all" && !isDictionaryId(target)) return { error: "수집 대상을 확인해 주세요.", ids: [] };
  // 전체 수집에서는 한 트랜잭션으로 두 요청을 등록한다.
  const keys = target === "all" ? dictionaries.map(({ id }) => id) : [target];
  const ids = await getDictionaryQueue().enqueueManual(keys);
  try {
    await dispatchDictionaries();
  } catch (error) {
    // 실행 요청에 실패해도 접수 자체는 보존하며 새 요청이나 다음 정기 호출에서 처리한다.
    console.error("[사전 워커 호출]", error);
    return { ids, warning: "작업은 접수됐으나 워커를 즉시 시작하지 못했습니다." };
  }
  return { ids };
}

/**
 * 사전의 자동 확인 활성 여부와 주기를 저장한다.
 * @param key 변경할 사전 식별자.
 * @param enabled 자동 확인 활성값.
 * @param days 일 단위 확인 주기.
 * @returns 저장 오류가 있으면 표시할 문구.
 */
export async function saveDictionarySchedule(key: unknown, enabled: unknown, days: unknown) {
  const failure = await checkAdminAction();
  if (failure) return { error: failure.error };
  if (!isDictionaryId(key) || typeof enabled !== "boolean" || typeof days !== "number" ||
    !Number.isSafeInteger(days) || days < 1) return { error: "자동 수집 설정을 확인해 주세요." };
  try {
    await getDictionaryQueue().configure(key, enabled, days);
    revalidatePath(ADMIN_DICTIONARIES_PATH);
    return {};
  } catch (error) {
    console.error("[사전 자동 수집 설정]", error);
    return { error: "자동 수집 설정을 저장하지 못했습니다." };
  }
}
