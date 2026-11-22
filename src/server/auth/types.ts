/** OAuth 제공자와 관계없이 저장하는 서비스 사용자 기본 정보. */
export type AuthProfile = {
  id: string;
  email: string;
  nickname: string;
  image: string | null;
};

/** 보호 요청마다 사용자 기본 키로 조회하는 접근 판단 자료. */
export type AuthUserState = Pick<AuthProfile, "id"> & { role: "USER" | "ADMIN" };

/** 로그인 시 계산하며 서비스 이용 제한에 사용하지 않는 동의 상태. */
export type ConsentRenewal = {
  required: boolean;
  overdue: boolean;
};

/** 세션 쿠키에 저장할 프로필과 판단 결과. */
export type AuthSessionUser = AuthProfile & { consentRenewal: ConsentRenewal };
