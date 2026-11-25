import { decode } from "next-auth/jwt";
import { isOAuthProvider, type OAuthProviderId } from "@/shared/config/oauth-providers";
import type { OAuthIdentity, SignupConsent } from "./enrollment";
import type { OAuthVerification } from "./oauth-providers";
import type { OAuthConnection } from "./types";

/** 최초 인증 화면과 복귀 화면을 연결하는 인증 목적. */
export type AuthPurpose = "login" | "signup" | "account-add";

/** 마이페이지에서 계정 추가를 시작한 내부 사용자와 로그인 연결. */
export type AccountAddActor = OAuthConnection & {
  /** 인증이 끝날 때도 같아야 하는 내부 사용자 ID. */
  userId: string;
};

/** 가입·로그인 완료와 구분되는 보호된 계정 추가 완료 화면. */
export const ACCOUNT_ADD_COMPLETION = "/mypage/account-complete";

/** 모든 상태에 공통으로 남기는 브라우저 요청과 동의 선택. */
type FlowContext = {
  /** OAuth 시작 시 선택하고 콜백 및 코드 교환에 사용하는 공급자. */
  provider: OAuthProviderId;
  /** 최초 가입 또는 로그인 목적. */
  purpose: AuthPurpose;
  /** 현재 요청에서 제출한 가입 동의이며 로그인에서는 비어 있다. */
  consent: SignupConsent[];
  /** 개별 쿠키, 콜백 및 완료 요청을 연결하는 브라우저별 난수. */
  state: string;
  /** 단계가 바뀌어도 유지하는 요청 만료 시각의 Unix 초. */
  expiresAt: number;
  /** 추가 인증에서만 사용하는 가입 선택 요청과 대상 내부 계정. */
  linkAttempt?: { parent: string; targetId: string };
  /** 마이페이지 계정 추가를 시작한 로그인 연결. */
  accountActor?: AccountAddActor;
};

/** 암호화 쿠키에 보관하는 초안, 콜백 대기, 교환 대기 상태. */
export type OAuthFlow = FlowContext & (
  // 재시도 초안에는 공급자와 동의만 남기고 이전 인가 자료는 폐기한다.
  | { stage: "draft" }
  // 콜백 대기에서는 요청을 공급자 응답과 대조할 확인 자료를 보관한다.
  | ({ stage: "pending" } & OAuthVerification)
  // 교환 대기에는 콜백의 일회성 코드와 공급자가 보낸 경우의 발급자 원본을 보관한다.
  | ({ stage: "ready"; code: string; responseIssuer?: string } & OAuthVerification)
  // 동일 이메일 후보를 선택하는 동안 최초 검증 결과를 서버 전용 쿠키에 보관한다.
  | { stage: "link-choice"; identity: OAuthIdentity & { email: string } }
);

/** Google 인증을 마치고 동일 이메일 계정 선택을 기다리는 가입 상태. */
export type OAuthLinkChoice = Extract<OAuthFlow, { stage: "link-choice" }>;

/** 공급자 요청·취소·완료를 같은 수명 안에 처리하는 최대 시간(초). */
export const OAUTH_FLOW_MAX_AGE = 10 * 60;

/**
 * 외부에서 받은 흐름 키의 문자와 길이를 확인한다.
 * @param value 쿠키 이름이나 내부 이동에 사용하기 전의 state 입력.
 * @returns 32바이트 Base64 URL 난수 형식과 일치하면 true.
 */
export function isOAuthFlowId(value: unknown): value is string {
  // 구분자와 공백을 허용하지 않아 쿠키 이름과 이동 쿼리에 안전하게 사용한다.
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * 다른 탭의 요청을 덮어쓰지 않는 개별 OAuth 쿠키 이름을 만든다.
 * @param state 형식을 검증한 개별 요청 식별자.
 * @returns 운영에서 호스트 제한을 적용한 요청별 쿠키 이름.
 */
export function oauthCookieName(state: string): string {
  // 요청 키는 JWT 암호화의 salt에도 사용해 다른 흐름으로 토큰을 옮길 수 없게 한다.
  return `${process.env.NODE_ENV === "production" ? "__Host-" : ""}g2b-oauth-flow-${state}`;
}

/**
 * 복호화한 JSON이 속성을 읽을 수 있는 객체인지 판별한다.
 * @param value 구조 검증 전의 JSON 입력.
 * @returns 배열과 null을 제외한 객체인 경우 true.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  // JSON 배열이나 null의 속성을 OAuth 상태로 해석하지 않는다.
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 쿠키 JSON에서 동의 이력으로 사용할 각 선택의 구조를 검증한다.
 * @param value 항목 식별자, 버전, 체크 여부를 포함해야 하는 JSON 입력.
 * @returns 동의 선택을 구성하는 키와 타입이 유효하면 true.
 */
function isConsent(value: unknown): value is SignupConsent {
  // 필드 누락이나 문자열 형태의 체크 값은 가입 동의로 사용할 수 없다.
  return isRecord(value) && typeof value.id === "string" && !!value.id
    && typeof value.version === "string" && !!value.version && typeof value.agreed === "boolean";
}

/**
 * 동일 이메일 후보 선택에 사용할 OAuth 응답의 구조가 유효한지 확인한다.
 * @param value 선택 쿠키에 포함된 최초 인증의 결과.
 * @param provider 최초 흐름에 연결된 공급자 식별자.
 * @returns 공급자 고유 키와 검증된 이메일, 선택 프로필의 형태가 유효하면 true.
 */
function isLinkIdentity(value: unknown, provider: OAuthProviderId): boolean {
  return isRecord(value) && value.provider === provider && typeof value.providerUserId === "string" && !!value.providerUserId
    && typeof value.email === "string" && !!value.email
    && (value.nickname === null || typeof value.nickname === "string")
    && (value.image === null || typeof value.image === "string");
}

/**
 * 암호화한 쿠키가 요청 식별자와 일치하고 현재 단계에 필요한 자료를 포함하는지 확인한다.
 * @param token 해당 흐름 키로 조회한 암호화 쿠키 값.
 * @param secret 복호화에 사용할 서버 비밀값.
 * @param state 요청의 검증된 흐름 식별자.
 * @returns 만료되지 않고 구조가 유효한 상태 또는 사용할 상태가 없으면 undefined.
 */
export async function decodeOAuthFlow(token: string | undefined, secret: string, state: string): Promise<OAuthFlow | undefined> {
  // 입력 키로 쿠키 이름을 구성할 수 없으면 복호화를 진행하지 않는다.
  if (!token || !isOAuthFlowId(state)) return undefined;
  try {
    // JWT 자체의 만료와 요청 시작 시각에 정한 만료를 모두 확인한다.
    const payload = await decode({ token, secret, salt: oauthCookieName(state) });
    // JWT와 서비스 상태의 만료값을 같은 Unix 초 기준으로 해석한다.
    const now = Math.floor(Date.now() / 1000);
    // 복호화에 성공해도 쿠키 내부의 상태는 구조 검증을 거친다.
    const flow = payload?.flow;
    if (!payload || !(payload.exp > now) || !isRecord(flow) || flow.state !== state
      || !isOAuthProvider(flow.provider) || (flow.purpose !== "signup" && flow.purpose !== "login" && flow.purpose !== "account-add")
      || typeof flow.expiresAt !== "number" || !Number.isSafeInteger(flow.expiresAt) || flow.expiresAt <= now
      || !Array.isArray(flow.consent) || !flow.consent.every(isConsent)
      || (flow.purpose !== "signup" && flow.consent.length > 0)) return undefined;

    // 계정 추가는 가입 흐름과 분리하고 로그인한 사용자 및 연결에만 묶는다.
    if (flow.purpose === "account-add") {
      const actor = flow.accountActor;
      if ((flow.stage !== "pending" && flow.stage !== "ready") || !isRecord(actor)
        || !isOAuthProvider(actor.provider) || typeof actor.userId !== "string" || !actor.userId || actor.userId.length > 128
        || typeof actor.providerUserId !== "string" || !actor.providerUserId || actor.providerUserId.length > 512
        || typeof actor.linkGeneration !== "string" || !actor.linkGeneration || actor.linkGeneration.length > 64) return undefined;
    } else if ("accountActor" in flow) return undefined;

    // 추가 인증은 별도 키와 대상이 있는 가입 대기 흐름에서만 허용한다.
    if ("linkAttempt" in flow) {
      const link = flow.linkAttempt;
      if (flow.purpose !== "signup" || (flow.stage !== "pending" && flow.stage !== "ready")
        || !isRecord(link) || !isOAuthFlowId(link.parent) || link.parent === state
        || typeof link.targetId !== "string" || !link.targetId || link.targetId.length > 128) return undefined;
    }
    // 초안과 후보 선택에는 이전 인가 코드, 발급자, 요청 검증값이 남아 있으면 안 된다.
    if (flow.stage === "draft" || flow.stage === "link-choice") {
      if ("nonce" in flow || "verifier" in flow || "code" in flow || "responseIssuer" in flow) return undefined;
      if (flow.stage === "draft") return "identity" in flow ? undefined : flow as OAuthFlow;
      return flow.purpose === "signup" && isLinkIdentity(flow.identity, flow.provider) ? flow as OAuthFlow : undefined;
    }
    // 검증된 최초 프로필은 후보 선택 토큰에만 저장한다.
    if ("identity" in flow) return undefined;
    // 대기 상태에서만 최초 토큰과 코드 교환을 검증할 난수를 사용한다.
    if (!isOAuthFlowId(flow.nonce) || !isOAuthFlowId(flow.verifier)) return undefined;
    // 최초 콜백 전에는 응답에서 생기는 인가 코드와 발급자 값이 없어야 한다.
    if (flow.stage === "pending" && !("code" in flow) && !("responseIssuer" in flow)) return flow as OAuthFlow;
    // 교환 대기에서는 코드 길이를 확인하고, 발급자가 있으면 문자열 형식도 검증한다.
    if (flow.stage === "ready" && typeof flow.code === "string" && flow.code.length > 0 && flow.code.length <= 1000
      && (!("responseIssuer" in flow) || isResponseIssuer(flow.responseIssuer))) {
      return flow as OAuthFlow;
    }
  } catch {
    // 암호 검증이 실패한 경우 대기 중인 요청으로 인정하지 않는다.
  }
}

/**
 * 공급자 응답의 발급자 값을 쿠키에 보관할 수 있는지 확인한다.
 * @param value 콜백에서 읽은 발급자 값.
 * @returns 비어 있지 않은 512자 이하 문자열이면 true. 발급자 일치 여부는 공급자 어댑터가 별도로 확인한다.
 */
function isResponseIssuer(value: unknown): value is string {
  // 빈 값이나 과도하게 긴 입력은 암호화 쿠키에 보관하지 않는다.
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

/**
 * 최초 가입 요청으로 연결된 계정 선택 화면의 내부 경로를 만든다.
 * @param state 암호화된 선택 쿠키의 검증된 요청 키.
 * @param notice 추가 인증 취소 또는 실패 등 선택 화면에서 표시할 안내 코드.
 * @returns 계정 선택 화면의 이동 경로.
 */
export function oauthLinkLocation(state: string, notice?: string): string {
  const query = new URLSearchParams({ flow: state });
  if (notice) query.set("notice", notice);
  return `/auth/link-account?${query}`;
}

/**
 * 완료 또는 취소된 요청에서 코드와 공급자 검증값을 제거한다.
 * @param flow 보존할 공급자, 목적, 동의, 만료를 포함한 인증 상태.
 * @returns 최초 만료 시각을 유지하는 재시도 초안.
 */
export function toOAuthDraft({ provider, purpose, consent, state, expiresAt }: OAuthFlow): OAuthFlow {
  // 실패한 흐름을 다시 교환할 수 없도록 보존할 속성만 선택한다.
  return { provider, purpose, consent, state, expiresAt, stage: "draft" };
}

/**
 * 콜백을 최초 요청과 대조하고 브라우저가 이동할 내부 경로를 결정한다.
 * @param flow 콜백 state로 조회한 단기 쿠키 상태.
 * @param provider 콜백 경로의 공급자 식별자.
 * @param params 공급자가 보내는 state, 인가 코드, 선택적 발급자 또는 인증 오류.
 * @returns 응답의 이동 경로와 쿠키 변경이 필요한 경우의 새 상태.
 */
export function resolveOAuthCallback(flow: OAuthFlow | undefined, provider: string, params: URLSearchParams): {
  location: string;
  flow?: OAuthFlow;
  clear?: boolean;
} {
  // 선택한 공급자와 콜백 경로가 다르거나 재시도 초안이면 코드가 있어도 처리하지 않는다.
  if (!flow || flow.stage === "draft" || flow.stage === "link-choice" || flow.provider !== provider) {
    return { location: "/login?notice=failed" };
  }
  // 실패 시 이동할 화면은 최초 인증 목적에서 결정한다.
  const path = flow.purpose === "signup" ? "/signup" : "/login";
  // 회원 계정 추가는 비로그인 전용 완료 화면을 사용하지 않는다.
  const adding = flow.purpose === "account-add";
  // 유일한 state가 정확히 일치할 때만 쿠키를 변경할 수 있다.
  const states = params.getAll("state");
  if (states.length !== 1 || states[0] !== flow.state) {
    return { location: adding ? "/mypage?account=failed" : `${path}?notice=failed` };
  }

  // 이미 받은 콜백은 기존 코드를 유지한 채 같은 완료 화면으로 보낸다.
  const completion = `${adding ? ACCOUNT_ADD_COMPLETION : "/auth/complete"}?flow=${flow.state}`;
  if (flow.stage === "ready") return { location: completion };

  // 인가 코드가 한 번만 전달됐는지 검사할 수 있도록 전체 값을 읽는다.
  const codes = params.getAll("code");
  // 최종 검증에 사용할 콜백 발급자를 읽는다. 공급자에 따라 이 값이 없을 수 있다.
  const issuers = params.getAll("iss");
  // 공급자 오류나 잘못된 코드·발급자 입력에서는 교환을 중단하고 해당 탭의 동의만 보존한다.
  if (params.has("error") || codes.length !== 1 || !codes[0] || codes[0].length > 1000
    || issuers.length > 1 || (issuers.length === 1 && !isResponseIssuer(issuers[0]))) {
    // 공급자 응답의 원문 대신 공개용 취소 또는 실패 코드만 전달한다.
    const notice = params.get("error") === "access_denied" ? "cancelled" : "failed";
    // 계정 추가는 복원할 가입 동의가 없으므로 실패한 흐름을 바로 폐기한다.
    if (adding) return { location: `/mypage?account=${notice}`, clear: true };
    return {
      location: flow.linkAttempt ? oauthLinkLocation(flow.linkAttempt.parent, notice) : `${path}?notice=${notice}&flow=${flow.state}`,
      flow: toOAuthDraft(flow),
    };
  }
  // 완료 액션이 해당 요청의 코드를 교환하고 발급자를 대조할 수 있도록 원본을 보존한다.
  return {
    location: completion,
    flow: { ...flow, stage: "ready", code: codes[0], ...(issuers.length ? { responseIssuer: issuers[0] } : {}) },
  };
}
