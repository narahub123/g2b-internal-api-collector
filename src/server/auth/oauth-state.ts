import { decode } from "next-auth/jwt";
import { isOAuthProvider, type OAuthProviderId } from "@/shared/config/oauth-providers";
import type { OAuthIdentity, SignupConsent } from "./enrollment";
import type { OAuthVerification } from "./oauth-providers";

/** 최초 인증 화면과 복귀 화면을 연결하는 인증 목적. */
export type AuthPurpose = "login" | "signup";

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
};

/** 암호화 쿠키에 보관하는 초안, 콜백 대기, 교환 대기 상태. */
export type OAuthFlow = FlowContext & (
  // 재시도 초안에는 공급자와 동의만 남기고 이전 인가 자료는 폐기한다.
  | { stage: "draft" }
  // 콜백 대기에서는 요청을 공급자 응답과 대조할 확인 자료를 보관한다.
  | ({ stage: "pending" } & OAuthVerification)
  // 교환 대기에는 검증된 콜백에서 받은 일회성 코드를 추가한다.
  | ({ stage: "ready"; code: string } & OAuthVerification)
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
      || !isOAuthProvider(flow.provider) || (flow.purpose !== "signup" && flow.purpose !== "login")
      || typeof flow.expiresAt !== "number" || !Number.isSafeInteger(flow.expiresAt) || flow.expiresAt <= now
      || !Array.isArray(flow.consent) || !flow.consent.every(isConsent)
      || (flow.purpose === "login" && flow.consent.length > 0)) return undefined;

    // 추가 인증은 별도 키와 대상이 있는 가입 대기 흐름에서만 허용한다.
    if ("linkAttempt" in flow) {
      const link = flow.linkAttempt;
      if (flow.purpose !== "signup" || (flow.stage !== "pending" && flow.stage !== "ready")
        || !isRecord(link) || !isOAuthFlowId(link.parent) || link.parent === state
        || typeof link.targetId !== "string" || !link.targetId || link.targetId.length > 128) return undefined;
    }
    // 초안과 후보 선택 단계는 기존 인가 코드 및 공급자 확인 값을 보관하지 않는다.
    if (flow.stage === "draft" || flow.stage === "link-choice") {
      if ("nonce" in flow || "verifier" in flow || "code" in flow) return undefined;
      if (flow.stage === "draft") return "identity" in flow ? undefined : flow as OAuthFlow;
      return flow.purpose === "signup" && isLinkIdentity(flow.identity, flow.provider) ? flow as OAuthFlow : undefined;
    }
    // 검증된 최초 프로필은 후보 선택 토큰에만 저장한다.
    if ("identity" in flow) return undefined;
    // 대기 상태에서만 최초 토큰과 코드 교환을 검증할 난수를 사용한다.
    if (!isOAuthFlowId(flow.nonce) || !isOAuthFlowId(flow.verifier)) return undefined;
    // 최초 콜백 전에는 아직 코드가 없어야 한다.
    if (flow.stage === "pending" && !("code" in flow)) return flow as OAuthFlow;
    // 교환 대기 상태에서는 비어 있지 않은 제한 길이의 코드만 인정한다.
    if (flow.stage === "ready" && typeof flow.code === "string" && flow.code.length > 0 && flow.code.length <= 1000) {
      return flow as OAuthFlow;
    }
  } catch {
    // 암호 검증이 실패한 경우 대기 중인 요청으로 인정하지 않는다.
  }
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
 * @param params 공급자가 보내는 state, 인가 코드 또는 인증 오류.
 * @returns 응답의 이동 경로와 쿠키 변경이 필요한 경우의 새 상태.
 */
export function resolveOAuthCallback(flow: OAuthFlow | undefined, provider: string, params: URLSearchParams): {
  location: string;
  flow?: OAuthFlow;
} {
  // 선택한 공급자와 콜백 경로가 다르거나 재시도 초안이면 코드가 있어도 처리하지 않는다.
  if (!flow || flow.stage === "draft" || flow.stage === "link-choice" || flow.provider !== provider) {
    return { location: "/login?notice=failed" };
  }
  // 실패 시 이동할 화면은 최초 인증 목적에서 결정한다.
  const path = flow.purpose === "signup" ? "/signup" : "/login";
  // 유일한 state가 정확히 일치할 때만 쿠키를 변경할 수 있다.
  const states = params.getAll("state");
  if (states.length !== 1 || states[0] !== flow.state) return { location: `${path}?notice=failed` };

  // 이미 받은 콜백은 기존 코드를 유지한 채 같은 완료 화면으로 보낸다.
  const completion = `/auth/complete?flow=${flow.state}`;
  if (flow.stage === "ready") return { location: completion };

  // 유효한 일회성 코드가 없는 경우 해당 탭의 동의만 남긴다.
  const codes = params.getAll("code");
  if (params.has("error") || codes.length !== 1 || !codes[0] || codes[0].length > 1000) {
    // 공급자 응답의 원문 대신 공개용 취소 또는 실패 코드만 전달한다.
    const notice = params.get("error") === "access_denied" ? "cancelled" : "failed";
    return {
      location: flow.linkAttempt ? oauthLinkLocation(flow.linkAttempt.parent, notice) : `${path}?notice=${notice}&flow=${flow.state}`,
      flow: toOAuthDraft(flow),
    };
  }
  // 완료 액션에서 해당 요청의 코드만 서버에서 교환하도록 대기 상태로 변경한다.
  return { location: completion, flow: { ...flow, stage: "ready", code: codes[0] } };
}
