"use server";

import { refresh } from "next/cache";
import { checkAdminAction } from "@/server/auth/business-access";

/**
 * 수집 성공 후 현재 목록을 갱신하고 수집 전 화면이 뒤로 가기에서 재사용되지 않도록 한다.
 * @throws Next.js가 서버 액션의 갱신 처리를 완료하지 못하면 호출 화면에 실패가 전달된다.
 */
export async function refreshCollectionNavigation() {
  const failure = await checkAdminAction();
  if (failure) return failure;
  refresh();
}
