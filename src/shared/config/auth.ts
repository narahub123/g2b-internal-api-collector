/** 브라우저 종료 후에도 유지되는 서비스 세션의 최대 유휴 시간(초). */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/** 가입 또는 로그인 후 사용하는 공통 도착 경로. */
export const AUTH_SUCCESS_PATH = "/mypage";

/** 고유 버전의 동의 문서와 재동의 정책. 날짜가 지정되면 시간대가 포함된 ISO 문자열을 사용한다. */
export type ConsentPolicy = {
  id: string;
  version: string;
  content: string;
  required: boolean;
  requiresRenewal: boolean;
  effectiveAt: string;
  renewalDeadline: string | null;
};

/** 개발 검증용 초기 문서. 공개 가입을 열기 전에 정식 문서와 버전을 배포한다. */
export const CONSENT_POLICIES: readonly ConsentPolicy[] = [
  {
    id: "terms",
    version: "preview-1",
    content: "이용약관 검증용 항목입니다.",
    required: true,
    requiresRenewal: false,
    effectiveAt: "2026-01-01T00:00:00+09:00",
    renewalDeadline: null,
  },
  {
    id: "privacy",
    version: "preview-1",
    content: "개인정보 수집·이용 동의 검증용 항목입니다.",
    required: true,
    requiresRenewal: false,
    effectiveAt: "2026-01-01T00:00:00+09:00",
    renewalDeadline: null,
  },
];
