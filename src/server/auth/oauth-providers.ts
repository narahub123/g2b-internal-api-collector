import type { OAuthProviderId } from "@/shared/config/oauth-providers";
import type { OAuthIdentity } from "./enrollment";
import { completeGoogleOAuth, startGoogleOAuth } from "./google";

/** 공급자가 코드 교환에 사용하는 확인 자료. */
export type OAuthVerification = {
  /** ID 토큰이 최초 요청에서 발급됐는지 확인하는 난수. */
  nonce: string;
  /** 인가 요청과 코드 교환을 연결하는 PKCE 원본. */
  verifier: string;
};

/** 공통 인증이 호출할 공급자별 인가 및 교환 계약. */
type OAuthAdapter = {
  /** 서비스가 생성한 state로 인가 URL과 확인 자료를 준비한다. */
  start: (state: string) => Promise<OAuthVerification & { url: string }>;
  /** 일회성 코드를 검증·교환해 서비스 공통 프로필을 반환한다. */
  complete: (code: string, flow: OAuthVerification & { state: string }) => Promise<OAuthIdentity>;
};

/** 공급자별 구현은 서버 레지스트리에서만 연결한다. */
export const oauthAdapters: Record<OAuthProviderId, OAuthAdapter> = {
  google: { start: startGoogleOAuth, complete: completeGoogleOAuth },
};
