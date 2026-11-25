import { redirect } from "next/navigation";
import { OAuthCompletion } from "@/features/service-auth/OAuthCompletion";
import { readOAuthFlow } from "@/server/auth/oauth-flow";
import { ACCOUNT_ADD_COMPLETION } from "@/server/auth/oauth-state";
import { requirePageAccess } from "@/server/auth/page-guard";

/**
 * 로그인한 브라우저에서 계정 추가 콜백의 일회성 완료 폼을 표시한다.
 * @param props.searchParams 콜백이 전달한 탭별 흐름 키.
 * @returns 기존 완료 폼을 재사용하는 회원 전용 화면.
 * @throws 보호 접근이 거절되거나 해당 흐름이 만료되면 내부 화면으로 이동한다.
 */
export default async function AccountCompletePage({ searchParams }: {
  searchParams: Promise<{ flow?: string | string[] }>;
}) {
  // 가입용 완료 화면의 비로그인 전용 정책과 분리한다.
  await requirePageAccess(ACCOUNT_ADD_COMPLETION);
  // 공급자 코드는 브라우저로 보내지 않고 완료 폼에 흐름 키만 전달한다.
  const flow = await readOAuthFlow((await searchParams).flow);
  if (flow?.purpose !== "account-add" || flow.stage !== "ready") redirect("/mypage?account=expired");
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      {/* 공급자에서 돌아온 뒤 기존 완료 폼이 선택한 계정의 검증을 요청한다. */}
      <OAuthCompletion state={flow.state} />
    </main>
  );
}
