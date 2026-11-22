import Link from "next/link";
import { redirect } from "next/navigation";
import { LinkAccountForm } from "@/features/service-auth/LinkAccountForm";
import { authNoticeMessage } from "@/features/service-auth/model";
import { verifyCurrentUser } from "@/server/auth/current-user";
import { listLinkChoices, readLinkChoice } from "@/server/auth/link-choice";
import { AUTH_SUCCESS_PATH } from "@/shared/config/auth";

/**
 * 최초 OAuth를 검증한 브라우저에만 동일 이메일 후보 선택과 별도 가입을 제공한다.
 * @param props.searchParams 해당 탭의 흐름 키와 인증 결과 안내 코드.
 * @returns 후보 선택 폼 또는 저장소에 접근할 수 없을 때의 오류 안내.
 * @throws 유효한 요청이 없거나 이미 로그인했다면 Next.js 이동 신호를 보낸다.
 */
export default async function LinkAccountPage({ searchParams }: {
  searchParams: Promise<{ flow?: string | string[]; notice?: string | string[] }>;
}) {
  // 레이아웃의 실행 순서와 무관하게 사용자 상태를 확인한 뒤 후보 정보를 조회한다.
  const auth = await verifyCurrentUser();
  if (auth.status === "authenticated") redirect(AUTH_SUCCESS_PATH);
  if (auth.status === "error") return <p role="alert">{authNoticeMessage("unavailable")}</p>;
  const params = await searchParams;
  const flow = await readLinkChoice(params.flow);
  if (!flow) redirect("/signup?notice=failed");
  const notice = authNoticeMessage(params.notice);
  try {
    // 내부 계정 ID와 전체 이름은 서버에 두고 폼에 필요한 두 필드만 전달한다.
    const candidates = (await listLinkChoices(flow)).map(({ selection, label }) => ({ selection, label }));
    return (
      <>
        {/* 동일 이메일 계정의 연결 또는 별도 가입을 선택하는 화면이다. */}
        <h1 className="text-2xl font-semibold">계정 선택</h1>
        {/* 추가 인증에서 복귀했을 때 취소나 실패의 원인을 표시한다. */}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        <LinkAccountForm state={flow.state} candidates={candidates} />
        <Link href="/login" className="text-sm underline underline-offset-4">로그인으로 돌아가기</Link>
      </>
    );
  } catch (error) {
    // 이메일과 후보 ID 등 개인정보 없이 저장소 오류의 유형만 기록한다.
    console.error("[OAuth 연결 후보 조회]", error instanceof Error ? error.name : "UnknownError");
    return <p role="alert">{authNoticeMessage("unavailable")}</p>;
  }
}
