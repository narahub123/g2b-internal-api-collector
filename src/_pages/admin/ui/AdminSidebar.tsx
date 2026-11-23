"use client";

import { PanelLeftIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { isPageBranch } from "@/shared/config/page-access";
import { Button } from "@/shared/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@/shared/ui/sidebar";
import { ADMIN_NAVIGATION, USER_NAVIGATION } from "../config/navigation";

/** 현재 관리자 경로를 표시하고 나라장터 업무와 공고 큐로 이동한다. */
export function AdminSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { dashboard, g2b } = ADMIN_NAVIGATION;
  const isAdminPage = isPageBranch(pathname, "/admin");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="관리자 메뉴 열기"
        >
          <PanelLeftIcon aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-72 max-w-[85vw] gap-0"
        aria-describedby={undefined}
      >
        <SheetTitle className="border-b px-4 py-3">관리자 메뉴</SheetTitle>
        {/* 데스크톱 기본 offcanvas는 본문 옆 공간을 예약하므로 Sheet 안에서 패널을 렌더링한다. */}
        <SidebarProvider className="min-h-0 flex-1">
          <Sidebar collapsible="none" className="w-full">
            <SidebarContent className="p-2">
              <nav aria-label="관리자 메뉴">
                <SidebarMenu>
                  {!isAdminPage && (
                    <UserNavigation
                      pathname={pathname}
                      onNavigate={() => setOpen(false)}
                    />
                  )}
                  <li className="px-2 py-2 text-xs font-medium text-muted-foreground">
                    관리자
                  </li>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === dashboard.href}
                    >
                      <Link
                        href={dashboard.href}
                        onNavigate={() => setOpen(false)}
                        aria-current={
                          pathname === dashboard.href ? "page" : undefined
                        }
                      >
                        {dashboard.label}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={pathname === g2b.href}>
                      <Link
                        href={g2b.href}
                        onNavigate={() => setOpen(false)}
                        aria-current={
                          pathname === g2b.href ? "page" : undefined
                        }
                      >
                        {g2b.label}
                      </Link>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                      {g2b.sections.map(({ href, label }) => {
                        // 접근 정책과 같은 경로 경계로 업무 상세의 활성 메뉴를 판단한다.
                        const isActive = isPageBranch(pathname, href);
                        return (
                          <SidebarMenuSubItem key={href}>
                            <SidebarMenuSubButton asChild isActive={isActive}>
                              <Link
                                href={href}
                                onNavigate={() => setOpen(false)}
                                aria-current={
                                  isActive
                                    ? pathname === href
                                      ? "page"
                                      : "location"
                                    : undefined
                                }
                              >
                                {label}
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton
                          asChild
                          isActive={pathname === g2b.noticeQueue.href}
                        >
                          <Link
                            href={g2b.noticeQueue.href}
                            onNavigate={() => setOpen(false)}
                            aria-current={
                              pathname === g2b.noticeQueue.href
                                ? "page"
                                : undefined
                            }
                          >
                            {g2b.noticeQueue.label}
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </SidebarMenuItem>
                  {isAdminPage && (
                    <UserNavigation
                      pathname={pathname}
                      onNavigate={() => setOpen(false)}
                    />
                  )}
                </SidebarMenu>
              </nav>
            </SidebarContent>
          </Sidebar>
        </SidebarProvider>
      </SheetContent>
    </Sheet>
  );
}

/** 사용자 메뉴를 기존 SidebarMenu 구조로 표시한다. */
function UserNavigation({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <>
      <li className="px-2 py-2 text-xs font-medium text-muted-foreground">
        사용자
      </li>
      {USER_NAVIGATION.map(({ href, label }) => (
        <SidebarMenuItem key={href}>
          <SidebarMenuButton asChild isActive={pathname === href}>
            <Link
              href={href}
              onNavigate={onNavigate}
              aria-current={pathname === href ? "page" : undefined}
            >
              {label}
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </>
  );
}
