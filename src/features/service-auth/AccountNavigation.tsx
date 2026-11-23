import { AUTH_SUCCESS_PATH } from "@/shared/config/auth";
import { canAccessPage, type PageRole } from "@/shared/config/page-access";
import { AccountDropdown } from "./AccountDropdown";

/** 접근 정책과 대조해 표시하는 계정 관련 서비스 링크. */
const links = [
  { href: "/", label: "홈" },
  { href: AUTH_SUCCESS_PATH, label: "마이페이지" },
  { href: "/admin", label: "관리자" },
];

/**
 * 서버에서 검증한 역할을 기준으로
 * 접근 가능한 계정 메뉴만 제공한다.
 */
export function AccountNavigation({
  role,
  profile,
}: {
  role: Exclude<PageRole, null>;
  profile: {
    nickname: string;
    email: string;
    image: string | null;
  };
}) {
  const visible = links.filter(({ href }) => canAccessPage(href, role));

  return (
    <nav aria-label="계정 메뉴" className="ml-auto">
      <AccountDropdown profile={profile} links={visible} />
    </nav>
  );
}
