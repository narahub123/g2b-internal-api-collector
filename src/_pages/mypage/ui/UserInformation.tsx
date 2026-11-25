import { verifyCurrentUser } from "@/server/auth/current-user";
import { profileImageUrl } from "@/server/auth/profile";
import { BasicInformation } from "./BasicInformation";

/**
 * 공통 페이지 검증 결과에서 최신 내부 프로필과 현재 로그인 이메일을 읽는다.
 * @returns 기본 정보 영역 또는 확인된 세션이 없을 때 null.
 */
export default async function UserInformation() {
  // 보호 레이아웃과 같은 요청의 DB 검증 결과를 재사용한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return null;
  // 화면에 필요한 표시 정보만 클라이언트 컴포넌트에 전달한다.
  return <BasicInformation key={auth.user.nickname} nickname={auth.user.nickname}
    image={profileImageUrl(auth.user.image)} email={auth.user.oauthAccount?.email ?? null} />;
}
