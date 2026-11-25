import { verifyCurrentUser } from "@/server/auth/current-user";
import { profileImageUrl } from "@/server/auth/profile";
import { BasicInformation } from "./BasicInformation";
import { UserDataCards } from "./UserDataCards";
import { myPageUserDataScope } from "@/server/auth/mypage-user-data";

/**
 * 공통 페이지 검증 결과에서 최신 내부 프로필과 현재 로그인 이메일을 읽는다.
 * @returns 기본 정보, 연결 계정, 동의 관리 영역 또는 세션이 없을 때 null.
 */
export default async function UserInformation() {
  // 보호 레이아웃과 같은 요청의 DB 검증 결과를 재사용한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return null;
  // 현재 로그인 이메일은 기존 접근 검증 결과에서 표시한다.
  const current = auth.user.oauthAccount;
  // 연결 계정과 동의 정보는 현재 로그인 연결의 쿼리에서 가져온다.
  return (
    <div className="grid gap-4">
      {/* 내부 프로필과 현재 인증 이메일은 기본 정보에 표시한다. */}
      <BasicInformation key={auth.user.nickname} nickname={auth.user.nickname}
        image={profileImageUrl(auth.user.image)} email={current.email} />
      {/* 기존 방문에서 읽은 유효한 업무 데이터는 동일 로그인 연결에서 재사용한다. */}
      <UserDataCards scope={myPageUserDataScope(auth)} sessionRenewal={auth.user.consentRenewal} />
    </div>
  );
}
