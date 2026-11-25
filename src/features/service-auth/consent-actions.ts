"use server";

import { verifyCurrentUser } from "@/server/auth/current-user";
import { recordConsentChange } from "@/server/auth/consent-management";
import { evaluateConsentRenewal } from "@/server/auth/consent-renewal";
import { openAuthRepository } from "@/server/auth/repository";
import { issueSession } from "@/server/auth/session";
import type { AuthSessionUser, ConsentRenewal } from "@/server/auth/types";
import { getG2bDatabase } from "@/server/g2b/repository";
import { CONSENT_POLICIES } from "@/shared/config/auth";

/**
 * 서버에서 계산한 재동의 상태가 바뀌었을 때만 현재 사용자 쿠키에 반영한다.
 * @param user 인증한 내부 사용자와 현재 OAuth 연결.
 * @param renewal 실제 이력에서 계산한 재동의와 마감 상태.
 * @throws 세션 쿠키 반영이 실패하면 오류를 전달한다.
 */
async function reflectConsentRenewal(user: AuthSessionUser, renewal: ConsentRenewal) {
  // 같은 상태를 반복 발급할 필요가 없으며 현재 OAuth 계정은 그대로 보존한다.
  if (user.consentRenewal.required === renewal.required && user.consentRenewal.overdue === renewal.overdue) return;
  await issueSession({ ...user, consentRenewal: renewal });
}

/**
 * 로그인한 사용자의 동의 또는 철회를 저장하고 커밋된 상태로 세션을 갱신한다.
 * @param form 사용자가 확인한 항목, 문서 버전, 체크 및 동작.
 * @returns 화면에서 구분할 저장, 새 버전 필요, 잘못된 제출, 인증 실패 또는 세션 재시도 결과.
 */
export async function submitConsentChange(form: FormData) {
  // 인증되지 않은 제출에 DB 변경 권한을 부여하지 않는다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return auth.status === "unauthenticated" ? "signed-out" : "failed";
  // 동의는 명시적으로 확인된 체크를 요구하며 철회는 확인 폼으로만 구분한다.
  const id = form.get("item");
  const operation = form.get("operation");
  if (typeof id !== "string" || (operation !== "agree" && operation !== "withdraw")) return "invalid";
  const version = form.get(`version:${id}`);
  if (typeof version !== "string" || (operation === "agree" && form.get(`consent:${id}`) !== "on")) return "invalid";
  try {
    // 저장 결과가 확정된 뒤에만 세션을 변경하고 저장과 세션 오류를 구분한다.
    const result = await recordConsentChange(getG2bDatabase(), auth.user.id, CONSENT_POLICIES,
      { id, version, agreed: operation === "agree" });
    if (result.status !== "saved") return result.status;
    try {
      await reflectConsentRenewal(auth.user, result.renewal);
      return "saved";
    } catch (error) {
      // 저장은 유지하고 다음 요청에서 이력만 읽어 세션을 복구할 수 있게 한다.
      console.error("[동의 세션 반영]", error instanceof Error ? error.name : "UnknownError");
      return "session-pending";
    }
  } catch (error) {
    // 세션과 문서 내용 없이 저장 오류 종류만 기록한다.
    console.error("[동의 이력 저장]", error instanceof Error ? error.name : "UnknownError");
    return "failed";
  }
}

/**
 * 저장은 끝났으나 쿠키 갱신이 실패한 경우 현재 이력에서 세션 상태를 다시 계산한다.
 * @returns 세션 복구 성공, 재시도 필요 또는 재로그인이 필요한 상태.
 */
export async function refreshConsentSession() {
  // 재시도 요청도 현재 OAuth 연결이 인증된 경우에만 진행한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return auth.status === "unauthenticated" ? "signed-out" : "session-pending";
  try {
    // 이력 쓰기 없이 로그인과 같은 판단 기준을 사용한다.
    const repository = openAuthRepository(getG2bDatabase());
    const renewal = await evaluateConsentRenewal(CONSENT_POLICIES, (id) => repository.findLatestConsent(auth.user.id, id));
    await reflectConsentRenewal(auth.user, renewal);
    return "saved";
  } catch (error) {
    // DB나 세션 갱신이 복구될 때까지 다시 시도할 수 있게 한다.
    console.error("[동의 세션 복구]", error instanceof Error ? error.name : "UnknownError");
    return "session-pending";
  }
}
