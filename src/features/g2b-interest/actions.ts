"use server";

import { refresh } from "next/cache";
import { verifyCurrentUser } from "@/server/auth/current-user";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openInterests, parseInterestKey } from "@/server/g2b/repository/interests";
import { COLLECTION_LIST_PAGE_SIZE } from "@/shared/config/collection-list";

/**
 * 현재 사용자의 관심 상태를 목표 상태에 맞춰 변경하고 탐색 캐시를 갱신한다.
 * @param input 업무 상세 식별자.
 * @param subscribed true이면 등록, false이면 제거한다.
 * @returns 변경 후 상태 또는 화면에 표시할 오류.
 */
export async function setInterest(input: unknown, subscribed: unknown) {
  // 페이지 방문 여부와 별개로 세션의 현재 사용자를 확인한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return { ok: false, error: "사용자 인증을 확인할 수 없습니다." } as const;
  // URL에서 허용하는 업무 키와 목표 상태만 받는다.
  const key = parseInterestKey(input);
  if (!key || typeof subscribed !== "boolean") return { ok: false, error: "관심 항목 정보가 올바르지 않습니다." } as const;

  try {
    // 원본 조회와 사용자별 변경을 공통 저장소에 맡긴다.
    const interests = openInterests(getG2bDatabase());
    if (subscribed) {
      // 원본이 삭제되었거나 대상에서 제외되면 상태를 바꾸지 않는다.
      if (!await interests.add(auth.user.id, key)) {
        return { ok: false, error: "관심 등록을 할 수 없는 업무입니다." } as const;
      }
    } else {
      // 이미 다른 화면에서 해제했으면 제거 완료 상태로 처리한다.
      await interests.remove(auth.user.id, [key]);
    }
    // 이전 화면으로 이동하거나 현재 목록을 다시 읽을 때 최신 상태를 표시한다.
    refresh();
    return { ok: true, subscribed } as const;
  } catch (error) {
    // 시스템 오류의 상세는 서버에서만 확인한다.
    console.error("[관심 상태 변경]", error);
    return { ok: false, error: "관심 상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요." } as const;
  }
}

/**
 * 현재 사용자가 선택한 한 페이지 분량의 관심 항목만 일괄 삭제한다.
 * @param input 선택된 업무 식별자 배열.
 * @returns 실제 삭제 건수 또는 화면에 표시할 오류.
 */
export async function removeInterests(input: unknown) {
  // 클라이언트에 의존하지 않고 요청을 보낸 사용자를 확인한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return { ok: false, error: "사용자 인증을 확인할 수 없습니다." } as const;
  // 현재 페이지에 표시할 수 있는 건수만 한 요청에서 처리한다.
  if (!Array.isArray(input) || !input.length || input.length > COLLECTION_LIST_PAGE_SIZE) {
    return { ok: false, error: "삭제할 관심 항목을 확인해 주세요." } as const;
  }
  // 모든 키를 먼저 검증해 유효하지 않은 선택이 있으면 변경을 시작하지 않는다.
  const keys = Array.from(input, parseInterestKey);
  if (!keys.every((key) => key !== undefined)) return { ok: false, error: "관심 항목 정보가 올바르지 않습니다." } as const;

  try {
    // 해당 사용자 관심 항목만 트랜잭션으로 제거한다.
    const count = await openInterests(getG2bDatabase()).remove(auth.user.id, keys);
    // 삭제 뒤 목록을 다시 조회해 바뀐 페이지 수까지 반영한다.
    refresh();
    return { ok: true, count } as const;
  } catch (error) {
    // 실패 시 선택을 다시 처리할 수 있도록 메시지만 반환한다.
    console.error("[관심 항목 일괄 삭제]", error);
    return { ok: false, error: "선택한 관심 항목을 삭제하지 못했습니다." } as const;
  }
}
