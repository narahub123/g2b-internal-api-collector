"use server";

import { MYPAGE_USER_PATH } from "@/shared/config/mypage";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { getG2bDatabase } from "@/server/g2b/repository";
import { verifyCurrentUser } from "@/server/auth/current-user";
import { activeConsentPolicies, linkEnrollment, resolveEnrollment, startEnrollmentSession, validateSignupConsent, type EnrollmentResult, type OAuthIdentity } from "@/server/auth/enrollment";
import { evaluateConsentRenewal } from "@/server/auth/consent-renewal";
import { listLinkChoices, readLinkChoice } from "@/server/auth/link-choice";
import { oauthAdapters } from "@/server/auth/oauth-providers";
import { OAUTH_FLOW_MAX_AGE, oauthLinkLocation, toOAuthDraft, type OAuthFlow } from "@/server/auth/oauth-state";
import { openAuthRepository } from "@/server/auth/repository";
import { addLinkedAccount } from "@/server/auth/linked-accounts";
import { isOAuthProvider } from "@/shared/config/oauth-providers";
import { clearOAuthFlow, readOAuthFlow, restoreOAuthDraft, writeOAuthFlow } from "@/server/auth/oauth-flow";
import { issueSession } from "@/server/auth/session";
import { AUTH_SUCCESS_PATH, CONSENT_POLICIES } from "@/shared/config/auth";
import { AUTH_ERROR_PATH } from "@/shared/config/page-access";
import type { AuthNotice } from "./model";

/**
 * 인증 페이지에 공개용 안내 코드를 붙여 이동한다.
 * @param path 인증 작업을 다시 진행할 내부 경로.
 * @param notice 사용자에게 표시할 허용된 안내 코드.
 * @param state 동의를 복원할 요청을 지정할 때 사용하는 흐름 키.
 * @throws Next.js 이동 신호로 현재 요청을 끝낸다.
 */
function redirectWithNotice(path: "/login" | "/signup", notice: AuthNotice, state?: string): never {
  // 오류 상세 대신 화면이 해석하는 안내 코드만 이동 경로에 추가한다.
  redirect(`${path}?notice=${notice}${state ? `&flow=${state}` : ""}`);
}

/**
 * 서버 액션에서 최신 세션과 사용자 상태를 검증하고 비로그인 요청만 계속한다.
 * @throws 로그인 상태이거나 인증 검증에 장애가 있으면 Next.js 이동 신호를 보낸다.
 */
async function verifyGuest() {
  // Layout 방문 여부와 무관하게 직접 호출된 요청을 검증한다.
  const auth = await verifyCurrentUser();
  // 유효한 로그인 상태라면 인증 절차를 다시 시작하지 않는다.
  if (auth.status === "authenticated") redirect(AUTH_SUCCESS_PATH);
  // 인증 상태를 확인할 수 없으면 가입·로그인을 중단하고 장애를 안내한다.
  if (auth.status === "error") redirect(AUTH_ERROR_PATH);
}

/**
 * 확정된 사용자에게 세션을 발급하고 인증 성공 또는 재로그인 경로로 이동한다.
 * @param result 저장소가 확정한 신규 또는 기존 회원 프로필.
 * @param state 처리한 OAuth 흐름의 키.
 * @throws 완료나 실패를 표시할 내부 페이지로 Next.js 이동 신호를 보낸다.
 */
async function finishSession(result: EnrollmentResult, state: string): Promise<never> {
  // 쿠키 발급 전에 이미 사용한 인가 흐름을 제거한다.
  await clearOAuthFlow(state);
  const repository = openAuthRepository(getG2bDatabase());
  /**
   * 로그인 직전에만 현재 동의 정책을 최신 기록과 대조한다.
   * @param id 세션을 발급할 내부 사용자 ID.
   * @returns 세션에 저장할 갱신과 기한 상태.
   * @throws 동의 이력 조회 오류가 있는 경우.
   */
  const status = await startEnrollmentSession(result, issueSession,
    (id) => evaluateConsentRenewal(CONSENT_POLICIES, (item) => repository.findLatestConsent(id, item)));
  if (status !== "authenticated") redirectWithNotice("/login", status);
  redirect(AUTH_SUCCESS_PATH);
}

/**
 * 쿠키에 묶인 공급자의 일회성 코드를 교환하고 반환된 공급자 식별자를 대조한다.
 * @param flow 콜백 검증을 통과한 교환 대기 상태.
 * @returns 계정 조회와 가입에 사용할 검증된 OAuth 식별자와 프로필.
 * @throws 공급자 교환 또는 식별자 확인에 실패한 경우.
 */
async function exchangeOAuth(flow: Extract<OAuthFlow, { stage: "ready" }>): Promise<OAuthIdentity> {
  // 콜백의 발급자 값을 포함한 교환 대기 상태를 같은 공급자에 전달하고 검증된 프로필을 받는다.
  const identity = await oauthAdapters[flow.provider].complete(flow.code, flow);
  // 프로필을 반환한 공급자가 최초 요청과 다르면 계정 연결에 사용하지 않는다.
  if (identity.provider !== flow.provider) throw new Error("OAuth 공급자가 일치하지 않습니다.");
  // 검증된 프로필을 호출자에게 넘겨 기존 계정 조회나 가입을 진행할 수 있게 한다.
  return identity;
}

/**
 * 로그인 계정에 묶인 별도의 OAuth 인증을 시작한다.
 * @param form 계정 추가 Dialog에서 선택한 공급자를 담은 폼.
 * @throws 로그인·마이페이지 안내 또는 공급자 인증으로 이동한다.
 */
export async function beginAccountOAuth(form: FormData): Promise<void> {
  // 변경 작업은 유효한 기존 로그인 세션에서만 시작한다.
  const auth = await verifyCurrentUser();
  if (auth.status === "unauthenticated") redirect("/login");
  if (auth.status === "error") redirect(AUTH_ERROR_PATH);
  // 사용자가 선택한 공개 공급자 등록만 사용한다.
  const provider = form.get("provider");
  // 지원하지 않는 공급자의 실패 결과를 사용자 정보 화면에서 표시한다.
  if (!isOAuthProvider(provider)) redirect(`${MYPAGE_USER_PATH}?account=failed`);
  // 탭별 쿠키와 OAuth 요청을 묶고 현재 계정과 내부 사용자를 기록한다.
  const state = randomBytes(32).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + OAUTH_FLOW_MAX_AGE;
  const { provider: actorProvider, providerUserId, linkGeneration } = auth.user.oauthAccount;
  let authorizationUrl: string;
  try {
    // 기존 공급자 어댑터가 선택 화면과 코드 검증값을 준비할 때까지 대기한다.
    const { url, nonce, verifier } = await oauthAdapters[provider].start(state);
    await writeOAuthFlow({ provider, state, expiresAt, purpose: "account-add", consent: [],
      stage: "pending", nonce, verifier, accountActor: { userId: auth.user.id, provider: actorProvider, providerUserId, linkGeneration } });
    authorizationUrl = url;
  } catch (error) {
    // 공급자 응답의 민감한 내용 없이 재시도 화면으로 돌려보낸다.
    console.error("[OAuth 계정 추가 시작]", error instanceof Error ? error.name : "UnknownError");
    // 연결을 시작하지 못하면 사용자 정보 화면에서 재시도하도록 안내한다.
    redirect(`${MYPAGE_USER_PATH}?account=failed`);
  }
  redirect(authorizationUrl);
}

/**
 * 연결 시작과 같은 사용자 및 로그인 연결인지 확인한 뒤 새 계정을 추가한다.
 * @param flow 계정 추가용 콜백의 검증된 일회성 교환 상태.
 * @throws 마이페이지의 처리 결과 또는 로그인 화면으로 이동한다.
 */
async function finishAccountOAuth(flow: Extract<OAuthFlow, { stage: "ready" }>): Promise<never> {
  // 쿠키를 소비하고 OAuth 요청을 시작했던 연결이 여전히 활성 상태인지 확인한다.
  await clearOAuthFlow(flow.state);
  const auth = await verifyCurrentUser();
  if (auth.status === "unauthenticated") redirect("/login");
  if (auth.status === "error") redirect(AUTH_ERROR_PATH);
  const actor = flow.accountActor;
  const current = auth.user.oauthAccount;
  if (!actor || actor.userId !== auth.user.id || actor.provider !== current.provider
    || actor.providerUserId !== current.providerUserId || actor.linkGeneration !== current.linkGeneration) {
    // 세션의 연결이 달라졌으면 등록을 중단하고 사용자 정보에서 만료를 안내한다.
    redirect(`${MYPAGE_USER_PATH}?account=expired`);
  }
  let result: Awaited<ReturnType<typeof addLinkedAccount>>;
  try {
    // 공급자 응답을 검증하고 만료되지 않은 경우만 소유권을 다시 확인해 저장한다.
    const identity = await exchangeOAuth(flow);
    result = flow.expiresAt <= Math.floor(Date.now() / 1000)
      ? "expired" : await addLinkedAccount(getG2bDatabase(), actor.userId, actor, identity);
  } catch (error) {
    // OAuth 코드와 공급자 개인정보는 로그와 화면에 전달하지 않는다.
    console.error("[OAuth 계정 추가 완료]", error instanceof Error ? error.name : "UnknownError");
    // 연결 저장 실패는 사용자 정보의 공통 안내로 표시한다.
    redirect(`${MYPAGE_USER_PATH}?account=failed`);
  }
  // 현재 서비스 세션을 유지한 채 사용자 정보에서 결과를 표시한다.
  redirect(`${MYPAGE_USER_PATH}?account=${result}`);
}

/**
 * 확인 Dialog에서 선택한 OAuth 연결을 현재 계정의 권한으로 해제한다.
 * @param form 해제할 연결 세대만 제출한 폼.
 * @throws 마이페이지 결과 또는 로그인 화면으로 이동한다.
 */
export async function unlinkOAuthAccount(form: FormData): Promise<void> {
  // 요청 사용자의 현재 세션을 검증하고 다른 사용자의 ID는 폼에서 받지 않는다.
  const auth = await verifyCurrentUser();
  if (auth.status === "unauthenticated") redirect("/login");
  if (auth.status === "error") redirect(AUTH_ERROR_PATH);
  const generation = form.get("generation");
  // 연결 세대 형식이 유효하지 않으면 삭제 전에 사용자 정보로 돌아간다.
  if (typeof generation !== "string" || !/^[a-f0-9-]{32,36}$/.test(generation)) redirect(`${MYPAGE_USER_PATH}?account=unlink-blocked`);
  let removed: boolean;
  try {
    // 서버에서 소유권, 현재 연결 및 마지막 계정 보호를 한 문장으로 확인한다.
    removed = await openAuthRepository(getG2bDatabase()).unlinkAccount(auth.user.id, auth.user.oauthAccount, generation);
  } catch (error) {
    console.error("[OAuth 계정 해제]", error instanceof Error ? error.name : "UnknownError");
    // 저장소 오류는 사용자 정보의 실패 안내로 전달한다.
    redirect(`${MYPAGE_USER_PATH}?account=failed`);
  }
  // 실제 해제 여부에 따라 사용자 정보에서 성공 또는 제한을 안내한다.
  // 같은 화면에서 연속 해제하더라도 별개의 성공 결과로 업무 캐시를 갱신한다.
  redirect(removed ? `${MYPAGE_USER_PATH}?account=unlinked&accountChange=${randomBytes(8).toString("hex")}` : `${MYPAGE_USER_PATH}?account=unlink-blocked`);
}

/**
 * 별도 가입을 선택하거나 기존 후보에 대한 별도 OAuth 인증을 시작한다.
 * @param form 최초 인증 흐름과 후보 화면의 선택을 담은 폼 데이터.
 * @throws 폼 결과에 따라 선택 화면, 가입 화면, 공급자 또는 세션 완료 경로로 이동한다.
 */
export async function chooseOAuthAccount(form: FormData): Promise<void> {
  // 폼의 이메일이나 계정 ID 대신 브라우저의 확인된 선택 쿠키를 읽는다.
  const flow = await readLinkChoice(form.get("flow"));
  if (!flow) redirectWithNotice("/signup", "failed");
  await verifyGuest();
  const choice = form.get("choice");
  if (choice === "separate") {
    // 별도 가입에서만 현재 법적 동의를 확인하고 새 계정의 이력을 저장한다.
    if (!validateSignupConsent(activeConsentPolicies(CONSENT_POLICIES), flow.consent)) {
      await restoreOAuthDraft(flow);
      redirectWithNotice("/signup", "consent", flow.state);
    }
    let result: EnrollmentResult;
    try {
      result = await resolveEnrollment(getG2bDatabase(), "signup", flow.identity, flow.consent, { allowSeparateAccount: true });
    } catch (error) {
      console.error("[별도 OAuth 가입]", error instanceof Error ? error.name : "UnknownError");
      redirect(oauthLinkLocation(flow.state, "failed"));
    }
    if (!("user" in result)) redirect(oauthLinkLocation(flow.state, result.status));
    await finishSession(result, flow.state);
  }

  // 후보 선택의 고유값을 다시 조회하고 추가 인증용 상태는 최초 흐름과 분리한다.
  let authorizationUrl: string;
  try {
    const selected = (await listLinkChoices(flow)).find(({ selection }) => selection === choice);
    if (!selected) throw new Error("등록된 OAuth 연결 후보가 없습니다.");
    const state = randomBytes(32).toString("base64url");
    const { url, nonce, verifier } = await oauthAdapters[flow.provider].start(state);
    await writeOAuthFlow({
      ...toOAuthDraft(flow), stage: "pending", state, nonce, verifier, consent: [],
      linkAttempt: { parent: flow.state, targetId: selected.id },
    });
    authorizationUrl = url;
  } catch (error) {
    console.error("[OAuth 추가 인증 요청]", error instanceof Error ? error.name : "UnknownError");
    redirect(oauthLinkLocation(flow.state, "failed"));
  }
  redirect(authorizationUrl);
}

/**
 * 두 번째 OAuth 인증으로 선택한 기존 계정을 확인하고 연결 행만 추가한다.
 * @param flow 추가 인증 콜백에서 읽은 코드 교환 대기 상태.
 * @param attempt 최초 선택 흐름과 대상 계정을 묶은 확인 자료.
 * @throws 실패하면 선택 화면으로, 성공하면 공통 세션 완료 경로로 이동한다.
 */
async function finishLinkOAuth(
  flow: Extract<OAuthFlow, { stage: "ready" }>,
  attempt: NonNullable<OAuthFlow["linkAttempt"]>,
): Promise<never> {
  // 추가 인증 전에 확인한 신규 계정 상태와 선택 대상이 아직 유효해야 한다.
  const source = await readLinkChoice(attempt.parent);
  if (!source) redirectWithNotice("/signup", "failed");
  await verifyGuest();
  await clearOAuthFlow(flow.state);
  let result: Awaited<ReturnType<typeof linkEnrollment>>;
  try {
    const proof = await exchangeOAuth(flow);
    result = await linkEnrollment(getG2bDatabase(), source.identity, attempt.targetId, proof);
  } catch (error) {
    console.error("[OAuth 추가 인증 완료]", error instanceof Error ? error.name : "UnknownError");
    redirect(oauthLinkLocation(source.state, "failed"));
  }
  if (!("user" in result)) redirect(oauthLinkLocation(source.state, result.status));
  return finishSession(result, source.state);
}

/**
 * 가입 또는 로그인 의도와 정책 선택을 검증하고 선택한 공급자의 일회성 요청을 만든다.
 * @throws Next.js 리다이렉트로 인증 화면, 안내 화면 또는 공급자 인증 페이지로 이동한다.
 * @param form 인증 목적, 공급자, 항목별 정책 버전과 동의 선택을 담은 폼 데이터.
 */
export async function beginOAuth(form: FormData): Promise<void> {
  // 콜백 이후에도 유지할 인증 목적을 요청에서 읽는다.
  const purpose = form.get("purpose");
  // 지원하지 않는 목적의 요청을 중단한다.
  if (purpose !== "signup" && purpose !== "login") redirectWithNotice("/login", "failed");
  // 실패 시 돌아갈 화면을 인증 목적에 따라 결정한다.
  const path = purpose === "signup" ? "/signup" : "/login";
  // 브라우저가 누른 버튼의 값을 서버의 공급자 목록과 대조한다.
  const provider = form.get("provider");
  if (!isOAuthProvider(provider)) redirectWithNotice(path, "failed");
  // 공급자 요청 전에 직접 호출자의 로그인 상태를 확인한다.
  await verifyGuest();
  // 현재 시행 중인 정책만 제출 데이터와 대조한다.
  const policies = activeConsentPolicies(CONSENT_POLICIES);
  // 가입에서만 항목별 버전과 체크 여부를 읽고 로그인에는 동의를 요구하지 않는다.
  const consent = purpose === "signup" ? policies.map(({ id }) => ({
    id, version: String(form.get(`version:${id}`) ?? ""), agreed: form.get(`consent:${id}`) === "on",
  })) : [];
  // 가입 필수 항목이나 현재 버전이 맞지 않으면 곧바로 재동의를 요청한다.
  if (purpose === "signup" && !validateSignupConsent(policies, consent)) redirectWithNotice(path, "consent");

  // 각 시작 요청에 독립적인 쿠키와 고정 만료 시각을 부여한다.
  const state = randomBytes(32).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + OAUTH_FLOW_MAX_AGE;
  const flow = { provider, purpose, consent, state, expiresAt } as const;
  // 쿠키 저장이 완료된 후 브라우저에 전달할 공급자 인가 주소.
  let url: string;
  try {
    // 공급자 장애에도 직전 동의 선택을 복원할 수 있도록 먼저 저장한다.
    await writeOAuthFlow({ ...flow, stage: "draft" });
    // 인가 URL과 코드 교환에 필요한 값을 선택한 공급자에게서 얻는다.
    const { url: authorizationUrl, nonce, verifier } = await oauthAdapters[provider].start(state);
    // 리다이렉트 전에 콜백 검증에 필요한 자료를 단기 쿠키에 저장한다.
    await writeOAuthFlow({
      ...flow, stage: "pending", nonce, verifier,
    });
    // 준비가 끝난 인가 주소를 성공 경로로 지정한다.
    url = authorizationUrl;
  // 공급자나 쿠키 준비가 실패한 경우 원래 화면에서 재시도할 수 있게 한다.
  } catch (error) {
    // 외부 오류의 구체적인 내용 대신 예외 유형을 기록한다.
    console.error("[OAuth 인증 요청]", error instanceof Error ? error.name : "UnknownError");
    // OAuth를 시작할 수 없었음을 공개용 코드로 알린다.
    redirectWithNotice(path, "failed", state);
  }
  // 준비 단계를 모두 마친 요청만 공급자 인가 화면으로 이동시킨다.
  redirect(url);
}

/**
 * 검증된 콜백 상태를 한 번의 코드 교환에 사용하고 가입 결과에 따라 서비스 세션을 발급한다.
 * 가입 커밋 후 발급 실패는 계정 저장을 되돌리지 않으며 자동으로 재시도하지 않는다.
 * @throws Next.js 리다이렉트로 완료 화면 또는 재시도 안내 화면으로 이동한다.
 * 쿠키 읽기·쓰기 오류는 호출자에게 전달되며, 공급자 교환이나 DB 저장 오류는 재시도 안내로 처리한다.
 * @param form 완료할 탭의 흐름 키를 담은 폼 데이터.
 */
export async function finishOAuth(form: FormData): Promise<void> {
  // 코드 교환 대기 상태를 현재 브라우저의 단기 쿠키에서 읽는다.
  const flow = await readOAuthFlow(form.get("flow"));
  // 정상 콜백 없이 완료 액션만 호출한 경우 인증을 시작하지 않는다.
  if (!flow || flow.stage !== "ready") redirectWithNotice("/login", "failed");
  // 회원 계정 추가는 기존 로그인 흐름과 분리하며 새 서비스 세션을 발급하지 않는다.
  if (flow.purpose === "account-add") return finishAccountOAuth(flow);
  // 추가 인증은 최초 가입 완료와 달리 선택한 내부 계정의 연결만 처리한다.
  if (flow.linkAttempt) return finishLinkOAuth(flow, flow.linkAttempt);
  // 가입과 로그인 URL 중 실패를 표시할 원래 화면을 선택한다.
  const path = flow.purpose === "signup" ? "/signup" : "/login";
  // 코드 교환과 DB 처리에 앞서 비로그인 상태를 다시 검증한다.
  await verifyGuest();
  // 후속 실패에서 동의는 복원하되 교환할 코드를 다음 요청에 남기지 않는다.
  await restoreOAuthDraft(flow);
  // OAuth가 진행되는 동안 정책이 바뀌었는지 확인하고 다르면 동의를 다시 받는다.
  if (flow.purpose === "signup" && !validateSignupConsent(activeConsentPolicies(CONSENT_POLICIES), flow.consent)) {
    // 새 정책에 동의하기 전까지 코드 교환과 데이터 저장을 건너뛴다.
    redirectWithNotice(path, "consent", flow.state);
  }

  // 공급자 검증 뒤 저장소에서 결정할 업무 결과를 보관한다.
  let result: Awaited<ReturnType<typeof resolveEnrollment>>;
  let identity: OAuthIdentity;
  // 코드 교환 또는 저장 실패를 사용자에게 노출할 안전한 메시지로 변환한다.
  try {
    // 폼 입력 대신 쿠키에 묶인 공급자가 코드를 교환한다.
    identity = await exchangeOAuth(flow);
    // 공급자 고유 키로 기존 회원을 확인하거나 가입 트랜잭션을 완료한다.
    result = await resolveEnrollment(getG2bDatabase(), flow.purpose, identity, flow.consent);
  } catch (error) {
    // 비밀이나 원본 응답 없이 실패 유형만 기록한다.
    console.error("[OAuth 인증 완료]", error instanceof Error ? error.name : "UnknownError");
    // 현재 인증 목적의 화면으로 복귀해서 새 인증을 시작할 수 있게 한다.
    redirectWithNotice(path, "failed", flow.state);
  }
  // 계정 선택 화면은 최초 OAuth 결과만 보존하고 추가 인증에서 새 코드를 요구한다.
  if (result.status === "link-required" && identity.email) {
    await writeOAuthFlow({ ...toOAuthDraft(flow), stage: "link-choice", identity: { ...identity, email: identity.email } });
    redirect(oauthLinkLocation(flow.state, "link-required"));
  }
  // 미가입 사용자의 로그인 요청에는 새 가입을 안내한다.
  if (result.status === "signup-required") {
    // 로그인 흐름이 종료됐으므로 해당 탭의 쿠키만 삭제한다.
    await clearOAuthFlow(flow.state);
    // 가입 화면에 미가입 상태를 공개용 안내로 전달한다.
    redirectWithNotice("/signup", "signup-required");
  }
  // 연결 대기 또는 프로필 누락은 저장된 사용자 없이 안내만 표시한다.
  if (!("user" in result)) redirectWithNotice(path, result.status, flow.state);
  // 신규 또는 기존 회원이 확정된 후에만 공통 세션을 발급한다.
  return finishSession(result, flow.state);
}
