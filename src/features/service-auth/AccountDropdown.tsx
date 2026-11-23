"use client";

import { useState } from "react";
import Link from "next/link";
import { House, LayoutDashboard, LogOut, UserRound } from "lucide-react";
import { Avatar } from "@/shared/ui/Avatar";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { LogoutForm } from "./LogoutForm";
import { ThemeSelector } from "@/shared/ui/theme-selector";

type AccountLink = {
  href: string;
  label: string;
};

type AccountDropdownProps = {
  profile: {
    nickname: string;
    email: string;
    image: string | null;
  };
  links: AccountLink[];
};

/**
 * 프로필 이미지로 스크롤 잠금 없이 계정 메뉴를 열고, 로그아웃을 선택하면 확인창을 표시한다.
 * @param props.profile 계정 메뉴에 표시할 사용자 프로필.
 * @param props.links 서버에서 접근 권한을 확인한 계정 메뉴 링크.
 * @returns 계정 메뉴와 로그아웃 확인창.
 */
export function AccountDropdown({ profile, links }: AccountDropdownProps) {
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

  return (
    <>
      {/* 계정 메뉴가 열려도 페이지 스크롤을 유지해 스크롤바 너비로 인한 화면 이동을 방지한다. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="계정 메뉴 열기"
          >
            <Avatar nickname={profile.nickname} image={profile.image} />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={8} className="w-64">
          <DropdownMenuLabel className="font-normal">
            <div className="flex items-center gap-3 py-1">
              <Avatar nickname={profile.nickname} image={profile.image} />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {profile.nickname}
                </p>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={profile.email}
                >
                  {profile.email}
                </p>
              </div>
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          {links.map(({ href, label }) => {
            const Icon =
              href === "/"
                ? House
                : href === "/admin"
                  ? LayoutDashboard
                  : UserRound;

            return (
              <DropdownMenuItem key={href} asChild>
                <Link href={href}>
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />

          {/* 계정 메뉴 내에서 테마를 변경한다. */}
          <div className="px-2 py-2">
            <ThemeSelector showLabel />
          </div>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => setLogoutDialogOpen(true)}
            className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <LogOut aria-hidden="true" className="text-destructive" />
            <span>로그아웃</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={logoutDialogOpen} onOpenChange={setLogoutDialogOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>로그아웃하시겠습니까?</AlertDialogTitle>

          <AlertDialogDescription>
            현재 계정에서 로그아웃합니다. 다시 이용하려면 로그인해야 합니다.
          </AlertDialogDescription>

          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                취소
              </Button>
            </AlertDialogCancel>

            <LogoutForm />
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
