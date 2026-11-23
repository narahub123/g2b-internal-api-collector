import type { ReactNode } from "react";
import type { AuthSessionUser } from "@/server/auth/types";
import type { PageRole } from "@/shared/config/page-access";
import { AccountNavigation } from "./AccountNavigation";

/** 인증된 화면이 공통 헤더에 전달하는 계정 정보와 선택 메뉴. */
type ServiceHeaderProps = {
  /** 계정 메뉴의 링크를 필터링하는 서버 검증 역할. */
  role: Exclude<PageRole, null>;
  /** 계정 메뉴에 표시하는 서버 검증 프로필. */
  profile: AuthSessionUser;
  /** 화면에서 왼쪽에 배치할 탐색 메뉴. */
  navigation?: ReactNode;
};

/**
 * 회원 화면의 공통 폭과 여백을 적용하고 탐색 메뉴와 계정·테마 메뉴를 양쪽에 배치한다.
 * @param props 검증된 역할과 계정 프로필 및 화면에서 제공하는 선택 탐색 메뉴.
 * @returns 공통 회원 화면 헤더.
 */
export function ServiceHeader({ role, profile, navigation }: ServiceHeaderProps) {
  // 헤더 테두리는 화면 전체에 표시하고 메뉴는 가운데 정렬된 영역에 배치한다.
  return (
    <header className="border-b bg-card px-4 py-2">
      <div className="mx-auto flex w-full min-w-0 max-w-5xl items-center gap-3">
        {/* 화면이 제공한 탐색 메뉴를 왼쪽에 배치한다. */}
        {navigation}
        {/* 탐색 메뉴가 없는 화면에서도 계정 메뉴는 오른쪽에 배치한다. */}
        <AccountNavigation role={role} profile={profile} />
      </div>
    </header>
  );
}
