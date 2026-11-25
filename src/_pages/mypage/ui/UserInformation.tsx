import { verifyCurrentUser } from "@/server/auth/current-user";
import { profileImageUrl } from "@/server/auth/profile";
import { BasicInformation } from "./BasicInformation";
import { ConnectedAccounts } from "./ConnectedAccounts";
import { openAuthRepository } from "@/server/auth/repository";
import { getG2bDatabase } from "@/server/g2b/repository";

/**
 * 공통 페이지 검증 결과에서 최신 내부 프로필과 현재 로그인 이메일을 읽는다.
 * @returns 기본 정보 영역 또는 확인된 세션이 없을 때 null.
 */
export default async function UserInformation() {
  // 보호 레이아웃과 같은 요청의 DB 검증 결과를 재사용한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return null;
  // 로그인에 사용한 연결을 확인하고 목록에 필요한 표시 정보만 넘긴다.
  const current = auth.user.oauthAccount;
  const accounts = (await openAuthRepository(getG2bDatabase()).listLinkedAccounts(auth.user.id)).map((account) => ({
    provider: account.provider, email: account.email, generation: account.linkGeneration,
    current: account.provider === current.provider && account.providerUserId === current.providerUserId
      && account.linkGeneration === current.linkGeneration,
  }));
  return (
    <div className="grid gap-4">
      {/* 내부 프로필과 현재 인증 이메일은 기본 정보에 표시한다. */}
      <BasicInformation key={auth.user.nickname} nickname={auth.user.nickname}
        image={profileImageUrl(auth.user.image)} email={current.email} />
      {/* 연결 변경은 독립 컴포넌트가 처리한다. */}
      <ConnectedAccounts accounts={accounts} />
    </div>
  );
}
