import Link from "next/link";
import { AuthForm } from "@/features/service-auth/AuthForm";
import { authNoticeMessage } from "@/features/service-auth/model";

/**
 * 공급자 로그인과 회원가입 이동 링크를 제공하고 인증 결과 안내를 표시한다.
 * @param props 로그인 페이지에 전달되는 요청 속성.
 * @param props.searchParams 로그인 결과를 나타내는 선택 안내 코드를 담은 쿼리.
 * @returns 로그인 폼, 해당하는 경우의 안내, 가입 링크.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ notice?: string | string[] }> }) {
  // URL의 허용된 안내 코드만 화면 메시지로 바꾼다.
  const notice = authNoticeMessage((await searchParams).notice);
  // 동의 입력 없이 시작할 수 있는 로그인 화면을 반환한다.
  return (
    <>
      {/* 로그인 페이지 제목으로 현재 화면 목적을 알린다. */}
      <h1 className="text-2xl font-semibold">로그인</h1>
      {/* 승인되지 않은 쿼리 문구를 숨기고 확인된 안내만 읽어 준다. */}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {/* 로그인 목적을 제출하는 공통 OAuth 폼을 표시한다. */}
      <AuthForm purpose="login" />
      {/* 아직 연결된 계정이 없는 사용자가 가입 화면으로 이동한다. */}
      <Link href="/signup" className="text-sm underline underline-offset-4">회원가입</Link>
    </>
  );
}
