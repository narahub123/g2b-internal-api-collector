import { parseInternalPage } from "@/shared/config/page-access";

/**
 * 현재 페이지의 접근 권한을 서버에 확인하고 Auth.js의 세션 쿠키를 갱신한다.
 * @param location 현재 렌더링된 서비스 페이지.
 * @returns 갱신 성공이면 null, 거절 응답에 안전한 이동 주소가 있으면 해당 내부 주소.
 * @throws 응답을 읽을 수 없거나 결과에 맞는 이동 주소가 없으면 공통 인증 오류 처리로 전달한다.
 */
export async function renewPageSession(location: string): Promise<string | null> {
  // 보호 화면을 재조회하지 않도록 서버 액션 대신 쿠키 갱신 응답만 읽는다.
  const response = await fetch("/api/auth/session", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(location),
  });
  // 같은 본문의 성공·거절을 구분하기 위해 HTTP 상태와 이동 주소를 함께 확인한다.
  const { destination } = await response.json();
  if (response.ok && destination === null) return null;

  // 로그인, 복귀, 장애 안내 등 유효한 내부 주소는 거절 응답에서만 사용한다.
  const safe = !response.ok && parseInternalPage(destination);
  if (safe) return safe.pathname + safe.search;

  // Origin 불일치처럼 주소가 없는 거절은 기존 공통 인증 오류로 처리한다.
  throw new Error(`페이지 세션 갱신 응답 오류 (HTTP ${response.status})`);
}
