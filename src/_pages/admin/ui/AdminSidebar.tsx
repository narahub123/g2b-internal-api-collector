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
import {
  ADMIN_NAVIGATION,
  USER_NAVIGATION,
  type NavigationItem,
} from "../config/navigation";

/**
 * 관리자 및 사용자 페이지로 이동할 수 있는 사이드바를 제공한다.
 * 현재 페이지의 경로를 확인하여 메뉴 그룹의 표시 순서를 결정한다.
 * 메뉴 설정에 정의된 항목을 표시하고 현재 경로에 해당하는 메뉴를 활성화한다.
 * 메뉴를 통한 페이지 이동이 시작되면 사이드바를 닫는다.
 * @returns 메뉴 열기 버튼과 관리자 및 사용자 메뉴를 포함한 사이드바.
 */
export function AdminSidebar() {
  // 현재 페이지의 경로를 가져와 메뉴 표시 순서와 활성 상태를 판단한다.
  const pathname = usePathname();

  // 사이드바의 열림 상태를 관리하며 최초에는 닫힌 상태로 표시한다.
  const [open, setOpen] = useState(false);

  // 현재 페이지가 관리자 영역에 속하는지 확인한다.
  const isAdminPage = isPageBranch(pathname, "/admin");

  /**
   * 메뉴를 통한 페이지 이동이 시작되면 사이드바를 닫는다.
   * 관리자 메뉴와 사용자 메뉴에서 동일하게 사용한다.
   */
  function handleNavigate() {
    // 사이드바의 열림 상태를 변경하여 패널을 닫는다.
    setOpen(false);
  }

  // 메뉴 열기 버튼과 현재 페이지에 맞게 구성된 사이드바를 반환한다.
  return (
    // 사이드바의 열림 상태를 연결하여 외부 조작에 따른 상태 변경을 반영한다.
    <Sheet open={open} onOpenChange={setOpen}>
      {/* 메뉴 열기 버튼을 사이드바를 여는 진입점으로 사용한다. */}
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="관리자 메뉴 열기"
        >
          {/* 사이드바 열기 기능을 나타내는 아이콘을 표시한다. */}
          <PanelLeftIcon aria-hidden="true" />
        </Button>
      </SheetTrigger>

      {/* 화면 왼쪽에 사이드바를 표시하고 작은 화면에서는 너비를 제한한다. */}
      <SheetContent
        side="left"
        className="w-72 max-w-[85vw] gap-0"
        aria-describedby={undefined}
      >
        {/* 사이드바의 제목을 표시하고 메뉴 영역과 구분한다. */}
        <SheetTitle className="border-b px-4 py-3">관리자 메뉴</SheetTitle>

        {/* 데스크톱 기본 offcanvas는 본문 옆 공간을 예약하므로 Sheet 안에서 패널을 렌더링한다. */}
        <SidebarProvider className="min-h-0 flex-1">
          {/* 별도의 접기 기능 없이 Sheet 내부의 전체 너비를 사용한다. */}
          <Sidebar collapsible="none" className="w-full">
            {/* 메뉴 항목을 표시하고 항목이 많아지면 스크롤할 수 있도록 구성한다. */}
            <SidebarContent className="p-2">
              {/* 보조 기술에서 관리자 메뉴 영역을 식별할 수 있도록 이름을 지정한다. */}
              <nav aria-label="관리자 메뉴">
                {/* 현재 페이지의 영역에 따라 메뉴 그룹의 표시 순서를 결정한다. */}
                <SidebarMenu>
                  {/* 사용자 페이지에서는 사용자 메뉴를 먼저 표시한다. */}
                  {!isAdminPage && (
                    <UserNavigation
                      pathname={pathname}
                      onNavigate={handleNavigate}
                    />
                  )}

                  {/* 관리자 메뉴 설정에 정의된 전체 메뉴를 표시한다. */}
                  <AdminNavigation
                    pathname={pathname}
                    onNavigate={handleNavigate}
                  />

                  {/* 관리자 페이지에서는 사용자 메뉴를 마지막에 표시한다. */}
                  {isAdminPage && (
                    <UserNavigation
                      pathname={pathname}
                      onNavigate={handleNavigate}
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

/** 메뉴 그룹을 표시하는 데 필요한 현재 경로와 페이지 이동 처리 함수를 정의한다. */
type NavigationProps = {
  /** 현재 페이지의 경로로 각 메뉴의 활성화 조건과 비교한다. */
  pathname: string;

  /** 메뉴를 통한 페이지 이동이 시작될 때 실행할 함수다. */
  onNavigate: () => void;
};

/** 계층형 메뉴 항목을 재귀적으로 표시하는 데 필요한 정보를 정의한다. */
type NavigationMenuItemProps = NavigationProps & {
  /** 현재 표시할 메뉴의 경로, 이름, 활성화 조건 및 하위 메뉴 정보다. */
  item: NavigationItem;

  /** 현재 메뉴의 계층 깊이이며 최상위 메뉴는 0부터 시작한다. */
  depth: number;
};

/**
 * 메뉴 하나와 해당 메뉴에 속한 하위 메뉴를 재귀적으로 표시한다.
 * 현재 경로와 메뉴의 활성화 조건을 비교하여 활성 상태를 결정한다.
 * 계층 깊이에 따라 최상위 메뉴 또는 하위 메뉴 컴포넌트를 선택한다.
 * 하위 메뉴가 존재하면 동일한 컴포넌트를 호출하여 다음 계층을 표시한다.
 * 하위 메뉴가 없으면 현재 메뉴만 반환하고 재귀 처리를 종료한다.
 * @param props 현재 메뉴, 계층 깊이, 페이지 경로 및 페이지 이동 처리 함수다.
 * @returns 현재 메뉴와 모든 하위 메뉴를 포함한 메뉴 항목.
 */
function NavigationMenuItem({
  item,
  depth,
  pathname,
  onNavigate,
}: NavigationMenuItemProps) {
  // 현재 메뉴의 이동 경로, 표시 이름, 활성화 조건 및 하위 메뉴를 가져온다.
  const { href, label, matchBranch, children } = item;

  // 하위 경로 포함 여부에 따라 현재 메뉴의 활성 상태를 결정한다.
  const isActive = matchBranch
    ? isPageBranch(pathname, href)
    : pathname === href;

  // 현재 메뉴가 최상위 메뉴인지 확인하여 사용할 컴포넌트를 결정한다.
  const isRoot = depth === 0;

  // 최상위 메뉴와 하위 메뉴에 기존 공용 메뉴 항목 스타일을 각각 적용한다.
  const MenuItem = isRoot ? SidebarMenuItem : SidebarMenuSubItem;

  // 최상위 메뉴와 하위 메뉴에 기존 공용 메뉴 버튼 스타일을 각각 적용한다.
  const MenuButton = isRoot ? SidebarMenuButton : SidebarMenuSubButton;

  /**
   * 현재 메뉴의 하위 항목을 다음 계층의 메뉴로 구성한다.
   * 계층 깊이를 증가시켜 하위 메뉴 스타일을 적용하고 재귀 처리를 이어간다.
   * @param child 현재 메뉴에 속한 하위 메뉴 정보다.
   * @returns 하위 메뉴와 해당 메뉴에 속한 모든 하위 항목.
   */
  function renderChild(child: NavigationItem) {
    // 현재 경로와 페이지 이동 처리 함수를 유지하면서 다음 계층을 표시한다.
    return (
      <NavigationMenuItem
        key={child.href}
        item={child}
        depth={depth + 1}
        pathname={pathname}
        onNavigate={onNavigate}
      />
    );
  }

  // 현재 메뉴와 하위 메뉴 목록을 하나의 계층형 메뉴 항목으로 반환한다.
  return (
    <MenuItem>
      {/* 현재 경로에 해당하는 메뉴에 활성화 스타일을 적용한다. */}
      <MenuButton asChild isActive={isActive}>
        {/* 메뉴의 이동 경로와 페이지 이동 시 실행할 함수를 연결한다. */}
        {/* 정확히 일치하는 경로에는 page, 활성화된 하위 경로에는 location을 지정한다. */}
        <Link
          href={href}
          onNavigate={onNavigate}
          aria-current={
            isActive ? (pathname === href ? "page" : "location") : undefined
          }
        >
          {/* 메뉴 설정에 정의된 표시 이름을 출력한다. */}
          {label}
        </Link>
      </MenuButton>

      {/* 하위 메뉴가 존재할 때만 다음 계층의 목록을 표시한다. */}
      {/* 하위 메뉴가 없으면 추가 호출 없이 현재 계층에서 재귀 처리를 종료한다. */}
      {children && children.length > 0 && (
        <SidebarMenuSub>
          {/* 하위 메뉴를 설정에 정의된 순서대로 재귀적으로 표시한다. */}
          {children.map(renderChild)}
        </SidebarMenuSub>
      )}
    </MenuItem>
  );
}

/**
 * 관리자 메뉴를 설정에 정의된 순서대로 표시한다.
 * 각 최상위 메뉴의 계층 깊이를 0으로 지정하여 재귀 렌더링을 시작한다.
 * 하위 메뉴의 구성과 활성 상태 판단은 NavigationMenuItem에서 처리한다.
 * @param props 현재 페이지의 경로와 페이지 이동 시 실행할 함수다.
 * @returns 관리자 영역 제목과 전체 계층형 메뉴 목록.
 */
function AdminNavigation({ pathname, onNavigate }: NavigationProps) {
  /**
   * 관리자 메뉴 설정의 항목을 최상위 메뉴로 구성한다.
   * @param item 표시할 관리자 최상위 메뉴 정보다.
   * @returns 최상위 메뉴와 해당 메뉴에 속한 전체 하위 메뉴.
   */
  function renderItem(item: NavigationItem) {
    // 계층 깊이를 0으로 지정하여 최상위 메뉴부터 표시한다.
    return (
      <NavigationMenuItem
        key={item.href}
        item={item}
        depth={0}
        pathname={pathname}
        onNavigate={onNavigate}
      />
    );
  }

  // 관리자 영역 제목과 설정을 기반으로 구성한 전체 메뉴를 반환한다.
  return (
    <>
      {/* 관리자 메뉴 그룹을 구분할 수 있도록 영역 제목을 표시한다. */}
      <li className="px-2 py-2 text-xs font-medium text-muted-foreground">
        관리자
      </li>

      {/* 관리자 메뉴 설정을 순회하여 정의된 순서대로 표시한다. */}
      {ADMIN_NAVIGATION.map(renderItem)}
    </>
  );
}

/**
 * 사용자 메뉴를 기존 SidebarMenu 구조로 표시한다.
 * 사용자 메뉴 설정을 순회하여 정의된 순서대로 이동 링크를 구성한다.
 * 현재 페이지와 메뉴 경로가 정확히 일치하면 해당 메뉴를 활성화한다.
 * @param props 현재 페이지의 경로와 페이지 이동 시 실행할 함수다.
 * @returns 사용자 영역 제목과 설정에 정의된 사용자 메뉴 목록.
 */
function UserNavigation({ pathname, onNavigate }: NavigationProps) {
  /**
   * 사용자 메뉴 설정의 항목을 최상위 메뉴로 구성한다.
   * @param item 표시할 사용자 메뉴 정보다.
   * @returns 현재 경로에 따른 활성 상태가 적용된 사용자 메뉴.
   */
  function renderItem(item: NavigationItem) {
    // 사용자 메뉴에도 동일한 메뉴 렌더링 컴포넌트를 사용한다.
    return (
      <NavigationMenuItem
        key={item.href}
        item={item}
        depth={0}
        pathname={pathname}
        onNavigate={onNavigate}
      />
    );
  }

  // 사용자 영역 제목과 설정을 기반으로 구성한 메뉴 목록을 반환한다.
  return (
    <>
      {/* 사용자 메뉴 그룹을 구분할 수 있도록 영역 제목을 표시한다. */}
      <li className="px-2 py-2 text-xs font-medium text-muted-foreground">
        사용자
      </li>

      {/* 사용자 메뉴 설정을 순회하여 정의된 순서대로 표시한다. */}
      {USER_NAVIGATION.map(renderItem)}
    </>
  );
}
