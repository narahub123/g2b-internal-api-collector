import { queryOptions } from "@tanstack/react-query";
import type { ManagedConsent } from "@/server/auth/consent-management";
import type { ConsentRenewal } from "@/server/auth/types";
import type { OAuthProviderId } from "@/shared/config/oauth-providers";

/** 로그아웃에서 모든 마이페이지 업무 쿼리를 제거하는 접두어. */
export const MYPAGE_USER_DATA_KEY = ["mypage", "user-data"] as const;

/** 사용자 정보 탭의 업무 데이터 응답. */
type MyPageUserData = {
  /** 화면에 표시할 연결 계정과 해제 요청에 필요한 연결 세대. */
  accounts: { provider: OAuthProviderId; email: string | null; generation: string; current: boolean }[];
  /** 정책별 동의 표시 항목 및 같은 이력에서 계산한 재동의 요약. */
  consents: { items: ManagedConsent[]; renewal: ConsentRenewal };
};

/** 사용자 정보의 요청 실패 상태를 UI에 전달한다. */
export class MyPageUserDataError extends Error {
  /**
   * @param status 업무 API의 실패 상태 코드.
   */
  constructor(readonly status: number) {
    // 클라이언트 오류에는 서버 응답 본문을 포함하지 않는다.
    super("사용자 정보를 불러오지 못했습니다.");
  }
}

/**
 * 현재 로그인 연결을 기준으로 업무 API와 탭 재방문 캐시를 연결한다.
 * @param scope 서버가 확인한 사용자와 로그인 연결의 비교값.
 * @returns 기존 Query Provider에서 공유할 옵션.
 */
export function myPageUserDataOptions(scope: string) {
  // 같은 연결의 동일 요청만 합치고 개별 실패는 화면에서 재시도할 수 있게 한다.
  return queryOptions({
    queryKey: [...MYPAGE_USER_DATA_KEY, scope],
    staleTime: 30_000,
    gcTime: 300_000,
    retry: false,
    /**
     * 현재 세션으로만 조회하고 계정 전환 시 이전 쿼리에 쓰지 않는다.
     * @param context 쿼리 취소 신호.
     * @returns 현재 연결의 업무 데이터.
     * @throws 서버가 데이터를 반환하지 못한 경우.
     */
    async queryFn({ signal }): Promise<MyPageUserData> {
      // 화면 렌더링과 API 요청 사이에 로그인 연결이 바뀌었는지 서버가 확인한다.
      const response = await fetch("/api/mypage/user-data", {
        signal, headers: { "x-g2b-mypage-scope": scope },
      });
      // 거절 응답이나 오류는 성공한 사용자 정보로 저장하지 않는다.
      if (!response.ok) throw new MyPageUserDataError(response.status);
      return response.json();
    },
  });
}
