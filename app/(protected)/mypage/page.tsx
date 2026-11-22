import { requirePageAccess } from "@/server/auth/page-guard";
import { AUTH_SUCCESS_PATH } from "@/shared/config/auth";

// 요청별 최신 사용자 상태를 확인한 뒤 개인 정보를 표시한다.
export const dynamic = "force-dynamic";

/**
 * 가입·로그인 완료 지점에서 회원 접근을 확인하고 개인 화면을 표시한다.
 * @returns 공통 회원 레이아웃 아래에 표시할 마이페이지.
 * @throws 미인증 또는 인증 장애에서는 공통 인증 경로로 이동한다.
 */
export default async function MyPage() {
  // 개인 정보를 표시하기 전에 쿠키와 최신 사용자 존재 여부를 확인한다.
  await requirePageAccess(AUTH_SUCCESS_PATH);
  // 표시용 프로필과 계정 메뉴는 공통 회원 레이아웃에서 제공한다.
  return (
    <main className="mx-auto grid max-w-lg gap-4 px-6 py-10">
      {/* 가입과 로그인 후 도착한 개인 화면을 식별한다. */}
      <h1 className="text-2xl font-semibold">마이페이지</h1>
    </main>
  );
}
