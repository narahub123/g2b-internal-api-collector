import { verifyCurrentUser } from "@/server/auth/current-user";
import { loadConsentManagement } from "@/server/auth/consent-management";
import { myPageUserDataScope } from "@/server/auth/mypage-user-data";
import { openAuthRepository } from "@/server/auth/repository";
import { getG2bDatabase } from "@/server/g2b/repository";
import { CONSENT_POLICIES } from "@/shared/config/auth";

/** 개인정보 응답은 브라우저 HTTP 캐시 및 공유 캐시에 보관하지 않는다. */
const headers = { "Cache-Control": "private, no-store" };

/**
 * 현재 회원의 연결 계정과 동의 관리에 필요한 표시 데이터를 조회한다.
 * @param request 페이지를 렌더링한 로그인 연결의 범위를 담은 요청.
 * @returns 탭의 업무 데이터 또는 인증·조회 상태를 나타내는 오류 응답.
 */
export async function GET(request: Request) {
  // 업무 데이터에 접근하기 전에 기존 회원 검증을 실행한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") {
    // 만료된 세션과 저장소 인증 장애를 기존 상태 코드로 구분한다.
    return new Response(null, { headers, status: auth.status === "error" ? 503 : 401 });
  }
  // 페이지 표시 후 쿠키가 바뀌었으면 다른 계정 데이터를 기존 쿼리에 저장하지 않는다.
  if (request.headers.get("x-g2b-mypage-scope") !== myPageUserDataScope(auth)) {
    return new Response(null, { headers, status: 409 });
  }
  try {
    // 현재 사용자에게 필요한 두 조회를 기존 저장소에서 함께 실행한다.
    const repository = openAuthRepository(getG2bDatabase());
    const [linkedAccounts, consents] = await Promise.all([
      repository.listLinkedAccounts(auth.user.id),
      loadConsentManagement(repository, auth.user.id, CONSENT_POLICIES),
    ]);
    // 현재 로그인 연결과 같은 계정만 화면에서 강조한다.
    const current = auth.user.oauthAccount;
    const accounts = linkedAccounts.map((account) => ({
      provider: account.provider, email: account.email, generation: account.linkGeneration,
      current: account.provider === current.provider && account.providerUserId === current.providerUserId
        && account.linkGeneration === current.linkGeneration,
    }));
    // 내부 사용자·공급자 식별자는 응답에 포함하지 않는다.
    return Response.json({ accounts, consents }, { headers });
  } catch (error) {
    // 실패 응답에 개인 데이터나 저장소 정보를 포함하지 않는다.
    console.error("[마이페이지 사용자 정보 조회]", error instanceof Error ? error.name : "UnknownError");
    return new Response(null, { headers, status: 500 });
  }
}
