/** 브라우저 종료 후에도 유지되는 서비스 세션의 최대 유휴 시간(초). */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/** 가입 또는 로그인 후 사용하는 공통 도착 경로. */
export const AUTH_SUCCESS_PATH = "/mypage";

/** 가입 화면의 전체 동의 기능 제공 여부. */
export const SIGNUP_ALL_CONSENTS_ENABLED = true;

/** 고유 버전의 동의 문서와 재동의 정책. 날짜가 지정되면 시간대가 포함된 ISO 문자열을 사용한다. */
export type ConsentPolicy = {
  // 동의 이력과 각 문서를 연결하는 고유 항목 ID.
  id: string;
  // 가입 및 마이페이지에서 구별할 수 있는 문서 이름.
  title: string;
  // 표시된 문서와 제출한 동의가 일치하는지 판단하는 문서 버전.
  version: string;
  // 사용자가 가입할 때 읽는 문서의 내용.
  content: string;
  // 가입을 완료하기 위한 필수 동의 여부.
  required: boolean;
  // 정책 버전 변경 시 재동의 판단 대상인지 나타낸다.
  requiresRenewal: boolean;
  // 정책을 표시하고 검증하기 시작하는 시각.
  effectiveAt: string;
  // 재동의 만료를 계산할 시각이며 기한이 없으면 null.
  renewalDeadline: string | null;
};

/** 개발 검증용 초기 문서. 공개 가입을 열기 전에 정식 문서와 버전을 배포한다. */
export const CONSENT_POLICIES: readonly ConsentPolicy[] = [
  // 개발용 이용약관의 필수 동의 항목.
  {
    id: "terms",
    title: "이용약관",
    version: "preview-1",
    content: "이용약관 검증용 항목입니다.",
    required: true,
    requiresRenewal: false,
    effectiveAt: "2026-01-01T00:00:00+09:00",
    renewalDeadline: null,
  },
  // 개발용 개인정보 처리 동의의 필수 항목.
  {
    id: "privacy",
    title: "개인정보 수집·이용 동의",
    version: "preview-1",
    content: "개인정보 수집·이용 동의 검증용 항목입니다.",
    required: true,
    requiresRenewal: false,
    effectiveAt: "2026-01-01T00:00:00+09:00",
    renewalDeadline: null,
  },
];
