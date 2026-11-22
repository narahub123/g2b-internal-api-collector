import Link from "next/link";
import { AUTH_SUCCESS_PATH } from "@/shared/config/auth";
import { canAccessPage, type PageRole } from "@/shared/config/page-access";
import { Avatar } from "@/shared/ui/Avatar";
import { LogoutForm } from "./LogoutForm";

/** 접근 정책과 대조해 표시하는 계정 관련 서비스 링크. */
const links = [
  { href: "/", label: "홈" },
  { href: AUTH_SUCCESS_PATH, label: "마이페이지" },
  { href: "/admin", label: "관리자" },
];

/**
 * 검증된 역할로 접근 가능한 계정 메뉴와 현재 브라우저의 로그아웃 폼을 표시한다.
 * @param props.role 서버에서 확인한 최신 로그인 역할.
 * @param props.profile 아바타와 이름에 사용할 세션 표시 정보.
 * @returns 역할별 계정 메뉴와 로그아웃 폼.
 */
export function AccountNavigation({ role, profile }: {
  role: Exclude<PageRole, null>;
  profile: { nickname: string; image: string | null };
}) {
  const visible = links.filter(({ href }) => canAccessPage(href, role));
  return (
    <nav aria-label="계정 메뉴" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span className="inline-flex items-center gap-2">
        <Avatar nickname={profile.nickname} image={profile.image} />
        <span>{profile.nickname}</span>
      </span>
      {visible.map(({ href, label }) => <Link key={href} href={href} className="hover:underline">{label}</Link>)}
      <LogoutForm />
    </nav>
  );
}
