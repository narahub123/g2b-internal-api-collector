import { redirect } from "next/navigation";
import { OAuthCompletion } from "@/features/service-auth/OAuthCompletion";
import { readOAuthFlow } from "@/server/auth/oauth-flow";
import { requirePageAccess } from "@/server/auth/page-guard";

/**
 * 브라우저에 검증된 콜백 상태가 있을 때만 가입·로그인 완료 요청을 표시한다.
 * @param props.searchParams 현재 탭의 OAuth 요청을 선택할 쿼리.
 * @returns 코드 교환을 요청하는 완료 화면.
 * @throws 이미 로그인했거나 완료 상태가 없으면 Next.js 이동 신호를 보낸다. 쿠키 설정 장애는 호출자에게 전달한다.
 */
export default async function OAuthCompletePage({ searchParams }: {
  searchParams: Promise<{ flow?: string | string[] }>;
}) {
  // 직접 주소 접근에서도 현재 로그인 상태를 확인한다.
  await requirePageAccess("/auth/complete");
  // 브라우저의 검증된 OAuth 흐름을 조회한다.
  const flow = await readOAuthFlow((await searchParams).flow);
  // 교환 대기 상태가 없으면 완료 폼을 표시하지 않는다.
  if (!flow || flow.stage !== "ready") redirect("/login?notice=failed");
  // 인가 코드나 검증값을 화면에 전달하지 않고 완료 액션만 제공한다.
  return (
    <>
      {/* 공급자 인증에서 서비스 처리로 넘어왔음을 알린다. */}
      <h1 className="text-2xl font-semibold">인증 완료</h1>
      {/* 검증된 단기 쿠키를 사용해 가입 또는 로그인을 완료한다. */}
      <OAuthCompletion state={flow.state} />
    </>
  );
}
