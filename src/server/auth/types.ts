/** OAuth 제공자와 관계없이 저장하는 서비스 사용자 기본 정보. */
export type AuthProfile = {
  id: string;
  email: string;
  nickname: string;
  image: string | null;
};

/** 보호 요청마다 사용자 기본 키로 조회하는 접근 판단 자료. */
export type AuthUserState = Pick<AuthProfile, "id" | "nickname" | "image"> & {
  // 보호된 화면과 업무 요청에서 확인하는 최신 권한.
  role: "USER" | "ADMIN";
};

/** 로그인 시 계산하며 서비스 이용 제한에 사용하지 않는 동의 상태. */
export type ConsentRenewal = {
  required: boolean;
  overdue: boolean;
};

/** 인증에 사용한 OAuth 연결을 서버에서 다시 식별할 수 있는 정보. */
export type AuthOAuthAccount = {
  // OAuth 공급자의 서비스 내부 식별자.
  provider: string;
  // 공급자가 인증한 계정의 고유 키.
  providerUserId: string;
  // 연결을 해제한 후 같은 계정을 다시 연결해도 구분할 수 있는 값.
  linkGeneration: string;
  // 이번 인증에서 공급자가 확인한 이메일이며 미제공이면 null.
  email: string | null;
};

/** 세션과 DB에서 같은 OAuth 연결인지 확인하는 키. */
export type OAuthConnection = Pick<AuthOAuthAccount, "provider" | "providerUserId" | "linkGeneration">;

/** 내부 사용자 프로필과 인증에 사용한 연결을 함께 전달한다. */
export type AuthOAuthProfile = AuthProfile & {
  // 로그인 또는 가입 완료에 사용한 계정의 식별 정보.
  oauthAccount: AuthOAuthAccount;
};

/** 세션 쿠키에 저장할 프로필과 판단 결과. */
export type AuthSessionUser = AuthProfile & {
  // 기존 쿠키를 읽는 전환 기간에는 연결 정보가 없을 수 있다.
  oauthAccount?: AuthOAuthAccount;
  // 로그인 시점에 계산한 재동의 상태.
  consentRenewal: ConsentRenewal;
};
