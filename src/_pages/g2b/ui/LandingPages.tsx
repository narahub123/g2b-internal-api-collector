import Link from "next/link";
import { AccountNavigation } from "@/features/service-auth/AccountNavigation";
import { AuthErrorToast, ClearPageHistory, PageActivity } from "@/features/service-auth/PageActivity";
import type { AuthSessionUser } from "@/server/auth/types";
import { canAccessPage } from "@/shared/config/page-access";
import type { CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";
import { G2bHomePage } from "./G2bHomePage";

/** 로그인 또는 가입을 시작할 공개 랜딩 메뉴. */
const guestLinks = [
  { href: "/login", label: "로그인" },
  { href: "/signup", label: "회원가입" },
];

/**
 * 회원 데이터를 요청하지 않는 공개 랜딩과 인증 진입 링크를 표시한다.
 * @param props.error 서버가 인증 상태를 확인하지 못해 Sonner 안내를 띄울지 여부.
 * @returns 방문자가 이용 가능한 공개 랜딩.
 */
export function GuestLanding({ error = false }: { error?: boolean }) {
  return (
    <main className="mx-auto grid min-h-svh max-w-lg content-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">나라장터 수집 자료</h1>
      {error ? <AuthErrorToast /> : (
        <>
          <ClearPageHistory />
          <p className="text-sm text-muted-foreground">저장된 나라장터 자료를 열려면 로그인해 주세요.</p>
          <nav aria-label="인증 메뉴" className="flex gap-4 text-sm">
            {guestLinks.filter(({ href }) => canAccessPage(href, null)).map(({ href, label }) => (
              <Link key={href} href={href} className="underline underline-offset-4">{label}</Link>
            ))}
          </nav>
        </>
      )}
    </main>
  );
}

/** 로그인 랜딩이 전달받는 세션 표시 정보와 기존 나라장터 목록 조회 조건. */
type LandingProps = { profile: AuthSessionUser; searchParams: Promise<CollectionSearchParams> };

/**
 * USER에게 계정 메뉴와 기존 나라장터 조회 목록을 표시한다.
 * @param props.profile 서버에서 확인한 서비스 세션 프로필.
 * @param props.searchParams 목록의 업무 탭, 검색과 페이지 조건.
 * @returns 일반 회원용 랜딩.
 */
export function UserLanding({ profile, searchParams }: LandingProps) {
  return (
    <>
      <header className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
        <AccountNavigation role="USER" profile={profile} />
      </header>
      <PageActivity />
      <G2bHomePage searchParams={searchParams} />
    </>
  );
}

/**
 * ADMIN에게 관리 메뉴와 기존 나라장터 조회 목록을 표시한다.
 * @param props.profile 서버에서 확인한 서비스 세션 프로필.
 * @param props.searchParams 목록의 업무 탭, 검색과 페이지 조건.
 * @returns 관리자용 랜딩.
 */
export function AdminLanding({ profile, searchParams }: LandingProps) {
  return (
    <>
      <header className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
        <AccountNavigation role="ADMIN" profile={profile} />
      </header>
      <PageActivity />
      <G2bHomePage searchParams={searchParams} />
    </>
  );
}
