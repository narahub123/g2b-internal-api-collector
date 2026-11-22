/** 로그인, 역할 부족, 인증 시스템 장애를 업무 오류와 구분하는 상태. */
export const BUSINESS_AUTH_STATUS = { unauthenticated: 401, forbidden: 403, unavailable: 503 } as const;

/** 업무 실행 전에 확인한 인증 실패 상태와 안전한 사용자 안내. */
export type BusinessAuthFailure = {
  auth: keyof typeof BUSINESS_AUTH_STATUS;
  error: string;
  /** 현재 페이지 접근도 거절된 경우 서버가 정한 안전한 복귀 주소. */
  destination?: string;
};

/** 일반 업무 실패와 인증 검증 실패를 구분하는 API 응답 헤더. */
export const BUSINESS_AUTH_HEADER = "x-g2b-business-auth";

/** 업무 권한 검사에는 사용하지 않고 거절 뒤 화면 복귀 여부만 판단하는 현재 경로. */
export const BUSINESS_PAGE_HEADER = "x-g2b-business-page";

/** 다운로드 브라우저가 검증된 이동 주소를 JSON으로 요청하는 헤더. */
export const DOWNLOAD_DESTINATION_HEADER = "x-g2b-download-destination";
