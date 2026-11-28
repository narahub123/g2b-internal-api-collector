"use server";

import { revalidatePath } from "next/cache";
import { checkAdminAction } from "@/server/auth/business-access";
import { CollectionBusyError } from "@/server/collections/blob-collection-store";
import { ADMIN_DICTIONARIES_PATH, ADMIN_MANAGE_PATH } from "../config/routes";
import { dictionaries, type DictionaryCollectionResult } from "./dictionaries";
import { dictionaryServer, isDictionaryId } from "./dictionary-server";

/**
 * 관리자 권한을 검증한 뒤 사전 하나 또는 전체를 수집한다.
 * @param target 전체 수집 또는 등록된 사전 식별자.
 * @returns 권한·입력 오류 또는 사전별 실행 결과.
 */
export async function collectDictionaries(target: unknown) {
  // 독립적으로 호출 가능한 서버 액션에서 권한을 다시 검증한다.
  const failure = await checkAdminAction();
  if (failure) return { error: failure.error, results: [] };
  if (target !== "all" && !isDictionaryId(target)) return { error: "수집 대상을 확인해 주세요.", results: [] };

  // 각 사전의 잠금과 실패를 독립적으로 처리하면서 화면 순서대로 실행한다.
  const selected = target === "all" ? dictionaries : dictionaries.filter(({ id }) => id === target);
  const results: DictionaryCollectionResult[] = [];
  const refreshedPaths: string[] = [];
  for (const { id, href } of selected) {
    try {
      const { status } = await dictionaryServer[id].collect();
      // 공용 수집 함수에서 알려진 저장 상태만 화면으로 전달한다.
      if (status !== "created" && status !== "updated" && status !== "unchanged") throw new Error("알 수 없는 수집 결과");
      results.push({ id, status });
      refreshedPaths.push(href);
    } catch (error) {
      const busy = error instanceof CollectionBusyError;
      if (!busy) console.error("[사전 수집]", id, error);
      results.push({ id, status: busy ? "busy" : "failed" });
    }
  }
  // 부분 성공이라도 영향을 받은 화면이 최신 저장 상태를 읽게 한다.
  if (refreshedPaths.length) {
    revalidatePath(ADMIN_MANAGE_PATH);
    revalidatePath(ADMIN_DICTIONARIES_PATH);
    for (const path of refreshedPaths) revalidatePath(path);
  }
  return { results };
}
