import { verifyCurrentUser } from "@/server/auth/current-user";
import { profileImageUrl } from "@/server/auth/profile";
import { BasicInformation } from "./BasicInformation";
import { ConnectedAccounts } from "./ConnectedAccounts";
import { ConsentManagement } from "./ConsentManagement";
import { openAuthRepository } from "@/server/auth/repository";
import { getG2bDatabase } from "@/server/g2b/repository";
import { loadConsentManagement } from "@/server/auth/consent-management";
import { CONSENT_POLICIES } from "@/shared/config/auth";

/**
 * 공통 페이지 검증 결과에서 최신 내부 프로필과 현재 로그인 이메일을 읽는다.
 * @returns 기본 정보, 연결 계정, 동의 관리 영역 또는 세션이 없을 때 null.
 */
export default async function UserInformation() {
  // 보호 레이아웃과 같은 요청의 DB 검증 결과를 재사용한다.
  const auth = await verifyCurrentUser();
  if (auth.status !== "authenticated") return null;
  // 로그인에 사용한 연결을 확인하고 목록에 필요한 표시 정보만 넘긴다.
  const current = auth.user.oauthAccount;
  // 독립적인 계정과 동의 조회를 같은 인증 결과로 시작한다.
  const repository = openAuthRepository(getG2bDatabase());
  const [linkedAccounts, consents] = await Promise.all([
    repository.listLinkedAccounts(auth.user.id),
    loadConsentManagement(repository, auth.user.id, CONSENT_POLICIES),
  ]);
  const accounts = linkedAccounts.map((account) => ({
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
      {/* 동의는 현재 정책과 이력에서 계산한 별도 카드로 표시한다. */}
      <ConsentManagement items={consents.items} sessionOutOfSync={
        auth.user.consentRenewal.required !== consents.renewal.required || auth.user.consentRenewal.overdue !== consents.renewal.overdue
      } />
    </div>
  );
}
