import { connection } from "next/server";
import { AdminLanding, GuestLanding, UserLanding } from "@/_pages/g2b/ui/LandingPages";
import { verifyCurrentUser } from "@/server/auth/current-user";
import type { CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";

/**
 * 서버에서 현재 사용자 상태를 읽어 같은 홈 경로에 역할별 화면을 표시한다.
 * @param props.searchParams 로그인한 사용자의 기존 나라장터 목록 조회 조건.
 * @returns 방문자, 일반 회원 또는 관리자 랜딩.
 */
export default async function Page({ searchParams }: { searchParams: Promise<CollectionSearchParams> }) {
  // 방문 전 정적 생성에서 요청 쿠키를 판독하지 않도록 한다.
  await connection();
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return <GuestLanding error={auth.status === "error"} />;
  // 회원 검증 이후에만 업무 목록을 렌더링해 저장소 조회를 허용한다.
  return auth.state.role === "ADMIN"
    ? <AdminLanding profile={auth.user} searchParams={searchParams} />
    : <UserLanding profile={auth.user} searchParams={searchParams} />;
}
