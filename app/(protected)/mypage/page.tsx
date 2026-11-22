import { redirect } from "next/navigation";
import { verifyCurrentUser } from "@/server/auth/current-user";

// 요청별 최신 사용자 상태를 확인한 뒤 개인 정보를 표시한다.
export const dynamic = "force-dynamic";

/**
 * 가입·로그인 완료 지점에서 최신 사용자 존재를 확인한 후 저장된 프로필을 표시한다.
 * @returns 로그인한 사용자에게 저장 닉네임을 표시하고 시스템 오류에는 공통 안내를 표시한다.
 * @throws 미인증이면 Next.js 이동 신호로 로그인 화면에 보낸다.
 */
export default async function MyPage() {
  // 개인 정보를 표시하기 전에 쿠키와 최신 사용자 존재 여부를 확인한다.
  const auth = await verifyCurrentUser();
  // 세션이 유효하지 않으면 개인 화면을 표시하지 않는다.
  if (auth.status === "unauthenticated") redirect("/login");
  // 인증 결과에 따라 안전한 오류 안내 또는 사용자 닉네임을 표시한다.
  return (
    <main className="mx-auto grid max-w-lg gap-4 px-6 py-10">
      {/* 가입과 로그인 후 도착한 개인 화면을 식별한다. */}
      <h1 className="text-2xl font-semibold">마이페이지</h1>
      {/* 사용자 상태 확인이 실패한 요청에는 프로필을 출력하지 않는다. */}
      {auth.status === "error"
        ? <p role="alert">인증 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.</p>
        : <p>{auth.user.nickname}</p>}
    </main>
  );
}
