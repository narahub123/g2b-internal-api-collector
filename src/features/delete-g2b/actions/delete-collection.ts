"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { getG2bRepository } from "@/server/g2b/repository";
import { isLocalDeletionRequest, parseCollectionDeletion } from "../model/input";

/**
 * 로컬 관리자 요청을 검증해 원본과 이력을 삭제하고 현재 화면과 탐색 캐시를 갱신한다.
 * @returns 삭제 완료 여부 및 확인창에 표시할 검증·충돌·저장소 오류 메시지.
 */
export async function deleteCollection(section: unknown, input: unknown) {
  if (!isLocalDeletionRequest(await headers())) {
    return { ok: false, error: "로컬 관리자 화면에서만 삭제할 수 있습니다." } as const;
  }
  const request = parseCollectionDeletion(section, input);
  if (!request) return { ok: false, error: "삭제 대상이 올바르지 않습니다." } as const;

  try {
    const result = await getG2bRepository().collectionDeletion.remove(request.section, request.targets);
    if (result.ok === false) {
      return {
        ok: false,
        error: result.reason === "busy"
          ? "수집 중이거나 수집 결과를 확인할 수 없는 대상이 있습니다."
          : "삭제 대상이 변경되었습니다. 페이지를 새로고침한 뒤 다시 선택해 주세요.",
      } as const;
    }
    refresh();
    return result;
  } catch (error) {
    console.error("[수집 데이터 삭제 실패]", request.section, error);
    return { ok: false, error: "삭제에 실패했습니다. 잠시 후 다시 시도해 주세요." } as const;
  }
}
