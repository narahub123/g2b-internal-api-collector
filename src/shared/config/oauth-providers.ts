/** 서버 등록과 공통 인증 화면이 공유하는 공개 공급자 정보. */
export const OAUTH_PROVIDERS = [{ id: "google", label: "Google" }] as const;

/** 지원하는 공급자 식별자. */
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number]["id"];

/**
 * 폼, 콜백 또는 쿠키에서 받은 식별자가 등록된 공급자인지 확인한다.
 * @param value 외부에서 받은 공급자 값.
 * @returns 공개 목록에 있는 식별자이면 true.
 */
export function isOAuthProvider(value: unknown): value is OAuthProviderId {
  // 등록 목록과 비교해 임의 공급자 이름이 처리 경로에 들어오지 않게 한다.
  return OAUTH_PROVIDERS.some(({ id }) => id === value);
}
