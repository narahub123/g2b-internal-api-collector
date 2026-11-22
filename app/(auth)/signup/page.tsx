import Link from "next/link";
import { AuthForm } from "@/features/service-auth/AuthForm";
import { authNoticeMessage } from "@/features/service-auth/model";
import { activeConsentPolicies } from "@/server/auth/enrollment";
import { readOAuthFlow } from "@/server/auth/oauth-flow";
import { CONSENT_POLICIES, SIGNUP_ALL_CONSENTS_ENABLED } from "@/shared/config/auth";

/**
 * 현재 정책으로 가입 동의 화면을 만들며 OAuth 재시도에서도 같은 버전의 선택을 복원한다.
 * @param props 회원가입 페이지에 전달되는 요청 속성.
 * @param props.searchParams OAuth 복귀 안내 코드를 담은 쿼리.
 * @returns 현재 법적 동의 정책과 복원된 체크 상태를 포함한 가입 화면.
 * @throws OAuth 쿠키를 읽는 데 필요한 서버 설정에 문제가 있는 경우.
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ notice?: string | string[] }> }) {
  // OAuth 복귀 코드와 기존 동의 선택을 함께 읽는다.
  const [params, flow] = await Promise.all([searchParams, readOAuthFlow()]);
  // 알려진 복귀 코드만 사용자 안내로 변환한다.
  const notice = authNoticeMessage(params.notice);
  // 현재 시행 중인 항목만 표시하고 제출을 요구한다.
  const items = activeConsentPolicies(CONSENT_POLICIES);
  // 가입 목적의 쿠키에서 현재 문서 버전과 일치하는 체크만 복원한다.
  const initialChecked = flow?.purpose === "signup"
    ? items.filter(({ id, version }) => flow.consent.some((choice) =>
      choice.id === id && choice.version === version && choice.agreed)).map(({ id }) => id)
    : [];
  // 현재 정책과 복원 자료를 가입 폼에 전달한다.
  return (
    <>
      {/* 사용자가 지금 진행 중인 가입 절차를 식별한다. */}
      <h1 className="text-2xl font-semibold">회원가입</h1>
      {/* 취소나 실패 등 매핑된 결과가 있을 때만 안내한다. */}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {/* 기존 동의 선택과 전체 동의 표시 설정으로 가입 폼을 구성한다. */}
      <AuthForm purpose="signup" items={items} initialChecked={initialChecked} allConsentsEnabled={SIGNUP_ALL_CONSENTS_ENABLED} />
      {/* 기존 회원이 로그인 화면으로 이동할 수 있게 한다. */}
      <Link href="/login" className="text-sm underline underline-offset-4">로그인</Link>
    </>
  );
}
