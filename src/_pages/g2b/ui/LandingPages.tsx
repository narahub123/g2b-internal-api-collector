import Link from "next/link";
import { ServiceHeader } from "@/features/service-auth/ServiceHeader";
import { AdminSidebar } from "@/_pages/admin/ui/AdminSidebar";
import { AuthErrorToast, ClearPageHistory, PageActivity } from "@/features/service-auth/PageActivity";
import type { AuthSessionUser } from "@/server/auth/types";
import { canAccessPage } from "@/shared/config/page-access";
import type { CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";
import { G2bHomePage } from "./G2bHomePage";
import { ThemeSelector } from "@/shared/ui/theme-selector";
import { ServiceMain } from "@/shared/ui/ServiceMain";
import { Button } from "@/shared/ui/button";

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
    <>
      <ClearPageHistory />

      {/* 인증 페이지와 동일한 헤더 */}
      <header className="px-4 py-2">
        <div className="mx-auto flex w-full min-w-0 max-w-5xl items-center justify-end">
          <ThemeSelector />
        </div>
      </header>

      {/* 인증 페이지와 동일한 본문 */}
      <ServiceMain>
        <div className="grid gap-6">
          <h1 className="text-2xl font-semibold">나라장터 수집 자료</h1>

          {error ? (
            <AuthErrorToast />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                저장된 나라장터 자료를 열려면 로그인해 주세요.
              </p>

              <nav
                aria-label="인증 메뉴"
                className="flex flex-wrap justify-end gap-2"
              >
                {guestLinks
                  .filter(({ href }) => canAccessPage(href, null))
                  .map(({ href, label }) => (
                    <Button
                      key={href}
                      asChild
                      variant={href === "/login" ? "default" : "outline"}
                    >
                      <Link href={href}>{label}</Link>
                    </Button>
                  ))}
              </nav>
            </>
          )}
        </div>
      </ServiceMain>
    </>
  );
}

/** 로그인 랜딩이 전달받는 세션 표시 정보와 기존 나라장터 목록 조회 조건. */
type LandingProps = { profile: AuthSessionUser; searchParams: Promise<CollectionSearchParams> };

/**
 * 일반 회원에게 공통 헤더와 기존 나라장터 조회 목록을 표시한다.
 * @param props.profile 서버에서 확인한 서비스 세션 프로필.
 * @param props.searchParams 목록의 업무 탭, 검색과 페이지 조건.
 * @returns 일반 회원용 랜딩.
 */
export function UserLanding({ profile, searchParams }: LandingProps) {
  return (
    <>
      {/* 공통 헤더에 검증된 역할과 계정 프로필을 전달한다. */}
      <ServiceHeader role="USER" profile={profile} />
      <PageActivity />
      <G2bHomePage searchParams={searchParams} />
    </>
  );
}

/**
 * 관리자에게 공통 헤더와 기존 나라장터 조회 목록을 표시한다.
 * @param props.profile 서버에서 확인한 서비스 세션 프로필.
 * @param props.searchParams 목록의 업무 탭, 검색과 페이지 조건.
 * @returns 관리자용 랜딩.
 */
export function AdminLanding({ profile, searchParams }: LandingProps) {
  return (
    <>
      {/* 공통 헤더에 검증된 역할과 계정 프로필을 전달한다. */}
      <ServiceHeader role="ADMIN" profile={profile} navigation={<AdminSidebar />} />
      <PageActivity />
      <G2bHomePage searchParams={searchParams} />
    </>
  );
}
