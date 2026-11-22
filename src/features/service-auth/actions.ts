"use server";

import { redirect } from "next/navigation";
import { getG2bDatabase } from "@/server/g2b/repository";
import { verifyCurrentUser } from "@/server/auth/current-user";
import { activeConsentPolicies, resolveEnrollment, startEnrollmentSession, validateSignupConsent } from "@/server/auth/enrollment";
import { completeGoogleOAuth, startGoogleOAuth } from "@/server/auth/google";
import { clearOAuthFlow, readOAuthFlow, restoreOAuthDraft, writeOAuthFlow } from "@/server/auth/oauth-flow";
import { issueSession } from "@/server/auth/session";
import { AUTH_SUCCESS_PATH, CONSENT_POLICIES } from "@/shared/config/auth";
import type { AuthNotice } from "./model";

/**
 * 인증 페이지에 공개용 안내 코드를 붙여 이동한다.
 * @param path 인증 작업을 다시 진행할 내부 경로.
 * @param notice 사용자에게 표시할 허용된 안내 코드.
 * @throws Next.js 이동 신호로 현재 요청을 끝낸다.
 */
function redirectWithNotice(path: "/login" | "/signup", notice: AuthNotice): never {
  // 오류 상세 대신 화면이 해석하는 안내 코드만 이동 경로에 추가한다.
  redirect(`${path}?notice=${notice}`);
}

/**
 * 서버 액션에서 최신 세션과 사용자 상태를 검증하고 비로그인 요청만 계속한다.
 * @param path 인증 장애 안내를 표시할 페이지.
 * @throws 로그인 상태이거나 인증 검증에 장애가 있으면 Next.js 이동 신호를 보낸다.
 */
async function verifyGuest(path: "/login" | "/signup") {
  // Layout 방문 여부와 무관하게 직접 호출된 요청을 검증한다.
  const auth = await verifyCurrentUser();
  // 유효한 로그인 상태라면 인증 절차를 다시 시작하지 않는다.
  if (auth.status === "authenticated") redirect(AUTH_SUCCESS_PATH);
  // 인증 상태를 확인할 수 없으면 가입·로그인을 중단하고 장애를 안내한다.
  if (auth.status === "error") redirectWithNotice(path, "unavailable");
}

/**
 * 가입 또는 로그인 의도와 정책 선택을 검증하고 Google에 보낼 일회성 요청을 만든다.
 * @throws Next.js 리다이렉트로 인증 화면, 안내 화면 또는 Google 인증 페이지로 이동한다.
 * @param form 인증 목적, 항목별 정책 버전과 동의 선택을 담은 폼 데이터.
 */
export async function beginOAuth(form: FormData): Promise<void> {
  // 콜백 이후에도 유지할 인증 목적을 요청에서 읽는다.
  const purpose = form.get("purpose");
  // 지원하지 않는 목적의 요청을 중단한다.
  if (purpose !== "signup" && purpose !== "login") redirectWithNotice("/login", "failed");
  // 실패 시 돌아갈 화면을 인증 목적에 따라 결정한다.
  const path = purpose === "signup" ? "/signup" : "/login";
  // Google 요청 전에 직접 호출자의 로그인 상태를 확인한다.
  await verifyGuest(path);
  // 현재 시행 중인 정책만 제출 데이터와 대조한다.
  const policies = activeConsentPolicies(CONSENT_POLICIES);
  // 가입에서만 항목별 버전과 체크 여부를 읽고 로그인에는 동의를 요구하지 않는다.
  const consent = purpose === "signup" ? policies.map(({ id }) => ({
    id, version: String(form.get(`version:${id}`) ?? ""), agreed: form.get(`consent:${id}`) === "on",
  })) : [];
  // 가입 필수 항목이나 현재 버전이 맞지 않으면 곧바로 재동의를 요청한다.
  if (purpose === "signup" && !validateSignupConsent(policies, consent)) redirectWithNotice(path, "consent");

  // 쿠키 저장이 완료된 후 브라우저에 전달할 Google 주소.
  let url: string;
  try {
    // 공급자 장애에도 직전 동의 선택을 복원할 수 있도록 먼저 저장한다.
    await writeOAuthFlow({ stage: "draft", purpose, consent });
    // 인가 URL과 브라우저의 최초 요청을 검증할 값을 Google 설정으로 구성한다.
    const started = await startGoogleOAuth();
    // 리다이렉트 전에 콜백 검증에 필요한 자료를 단기 쿠키에 저장한다.
    await writeOAuthFlow({
      stage: "pending", purpose, consent, state: started.state, nonce: started.nonce, verifier: started.verifier,
    });
    // 준비가 끝난 Google 주소를 성공 경로로 지정한다.
    url = started.url;
  // 공급자나 쿠키 준비가 실패한 경우 원래 화면에서 재시도할 수 있게 한다.
  } catch (error) {
    // 외부 오류의 구체적인 내용 대신 예외 유형을 기록한다.
    console.error("[Google 인증 요청]", error instanceof Error ? error.name : "UnknownError");
    // OAuth를 시작할 수 없었음을 공개용 코드로 알린다.
    redirectWithNotice(path, "failed");
  }
  // 준비 단계를 모두 마친 요청만 Google 인가 화면으로 이동시킨다.
  redirect(url);
}

/**
 * 검증된 콜백 상태를 한 번의 코드 교환에 사용하고 가입 결과에 따라 서비스 세션을 발급한다.
 * 가입 커밋 후 발급 실패는 계정 저장을 되돌리지 않으며 자동으로 재시도하지 않는다.
 * @throws Next.js 리다이렉트로 완료 화면 또는 재시도 안내 화면으로 이동한다.
 * 쿠키 읽기·쓰기 오류는 호출자에게 전달되며, Google 교환이나 DB 저장 오류는 재시도 안내로 처리한다.
 */
export async function finishOAuth(): Promise<void> {
  // 코드 교환 대기 상태를 현재 브라우저의 단기 쿠키에서 읽는다.
  const flow = await readOAuthFlow();
  // 정상 콜백 없이 완료 액션만 호출한 경우 인증을 시작하지 않는다.
  if (!flow || flow.stage !== "ready") redirectWithNotice("/login", "failed");
  // 가입과 로그인 URL 중 실패를 표시할 원래 화면을 선택한다.
  const path = flow.purpose === "signup" ? "/signup" : "/login";
  // 코드 교환과 DB 처리에 앞서 비로그인 상태를 다시 검증한다.
  await verifyGuest(path);
  // 후속 실패에서 동의는 복원하되 교환할 코드를 다음 요청에 남기지 않는다.
  await restoreOAuthDraft(flow);
  // OAuth가 진행되는 동안 정책이 바뀌었는지 확인하고 다르면 동의를 다시 받는다.
  if (flow.purpose === "signup" && !validateSignupConsent(activeConsentPolicies(CONSENT_POLICIES), flow.consent)) {
    // 새 정책에 동의하기 전까지 코드 교환과 데이터 저장을 건너뛴다.
    redirectWithNotice(path, "consent");
  }

  // 공급자 검증 뒤 저장소에서 결정할 업무 결과를 보관한다.
  let result: Awaited<ReturnType<typeof resolveEnrollment>>;
  // 코드 교환 또는 저장 실패를 사용자에게 노출할 안전한 메시지로 변환한다.
  try {
    // Google 코드와 최초 요청의 검증값을 교환해 검증된 사용자 정보를 얻는다.
    const identity = await completeGoogleOAuth(flow.code, flow);
    // 공급자 고유 키로 기존 회원을 확인하거나 가입 트랜잭션을 완료한다.
    result = await resolveEnrollment(getG2bDatabase(), flow.purpose, identity, flow.consent);
  } catch (error) {
    // 비밀이나 원본 응답 없이 실패 유형만 기록한다.
    console.error("[Google 인증 완료]", error instanceof Error ? error.name : "UnknownError");
    // 현재 인증 목적의 화면으로 복귀해서 새 인증을 시작할 수 있게 한다.
    redirectWithNotice(path, "failed");
  }
  // 미가입 사용자의 로그인 요청에는 새 가입을 안내한다.
  if (result.status === "signup-required") {
    // 로그인 흐름이 종료됐으므로 가입에서 새 Google 인증을 받도록 쿠키를 삭제한다.
    await clearOAuthFlow();
    // 가입 화면에 미가입 상태를 공개용 안내로 전달한다.
    redirectWithNotice("/signup", "signup-required");
  }
  // 연결 대기 또는 프로필 누락은 저장된 사용자 없이 안내만 표시한다.
  if (!("user" in result)) redirectWithNotice(path, result.status);
  // 내부 사용자가 확정되면 더 이상 필요 없는 OAuth 쿠키를 제거한다.
  await clearOAuthFlow();
  // 가입 트랜잭션이 끝난 사용자에 한해 공통 세션 발급을 한 번 수행한다.
  const status = await startEnrollmentSession(result, issueSession);
  // 실패 시 자동으로 다시 발급하지 않고 로그인으로 이동한다.
  if (status !== "authenticated") redirectWithNotice("/login", status);
  // 성공한 신규·기존 회원은 공통 도착 경로로 이동한다.
  redirect(AUTH_SUCCESS_PATH);
}
