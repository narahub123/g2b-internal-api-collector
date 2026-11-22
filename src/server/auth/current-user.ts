import { cache } from "react";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openAuthRepository } from "./repository";
import { createAuthVerification } from "./session";

/**
 * 동일 서버 렌더링에서 쿠키와 최신 사용자 상태를 확인한 결과를 공유한다.
 * @returns 검증된 사용자와 현재 권한, 미인증 또는 시스템 오류 상태.
 */
export const verifyCurrentUser = cache(() =>
  // 유효한 쿠키로 내부 ID가 확인된 경우에만 저장소에서 사용자 상태를 읽는다.
  createAuthVerification((id) => openAuthRepository(getG2bDatabase()).findUserState(id))());
