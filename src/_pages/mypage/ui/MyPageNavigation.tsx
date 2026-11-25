"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { MYPAGE_MENUS, myPageMenuPath } from "@/shared/config/mypage";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerClose,
} from "@/shared/ui/drawer";

/**
 * 현재 주소에서 선택 메뉴를 결정하고 PC 탭과 모바일 드로어로 이동을 제공한다.
 * @param props.children 선택된 경로에서 렌더링한 본문.
 * @returns 반응형 메뉴 및 선택된 콘텐츠.
 */
export default function MyPageNavigation({ children }: { children: ReactNode }) {
  // 탭을 선택한 시점에만 탐색을 시작하고 브라우저 이력을 남긴다.
  const router = useRouter();
  // 업무 하위 화면에서도 부모 메뉴를 강조하도록 레이아웃 바로 아래의 세그먼트를 읽는다.
  const segment = useSelectedLayoutSegment();
  // 직접 접근과 브라우저 탐색 모두 현재 경로에서 메뉴를 결정한다.
  const activeMenu = MYPAGE_MENUS.find((menu) => menu.id === segment);
  // 등록된 메뉴가 없는 화면은 레이아웃에 전달된 오류 또는 대체 본문을 표시한다.
  if (!activeMenu) return children;

  /**
   * 탭의 마우스 또는 키보드 선택을 실제 페이지 이동으로 연결한다.
   * @param id 기존 탭 컴포넌트가 전달한 선택 값.
   */
  function navigateToMenu(id: string) {
    // 등록된 메뉴만 이동 대상으로 사용한다.
    const menu = MYPAGE_MENUS.find((item) => item.id === id);
    // 현재 탭을 다시 선택할 때는 쿼리와 브라우저 이력을 보존한다.
    if (menu && menu.id !== segment) router.push(myPageMenuPath(menu.id));
  }

  // PC와 모바일에서 현재 주소의 본문을 공유한다.
  return (
    <Tabs
      value={activeMenu.id}
      onValueChange={navigateToMenu}
      className="grid min-w-0 gap-6"
    >
      {/* PC에서는 메뉴를 가로로 배치하고 선택된 메뉴를 강조한다. */}
      <div className="hidden min-w-0 border-b md:block">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-6 rounded-none bg-transparent p-0">
          {/* 활성 탭만 현재 화면의 탭 패널을 참조한다. */}
          {MYPAGE_MENUS.map((menu) => (
            <TabsTrigger
              key={menu.id}
              value={menu.id}
              {...(menu.id === activeMenu.id
                ? {}
                : { "aria-controls": undefined })}
              className="cursor-pointer flex-none rounded-none border-0 border-b-2 border-transparent px-2 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              {menu.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* 모바일 메뉴는 드로어에서 선택한다. */}
      <div className="md:hidden">
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              {activeMenu.label}
              <ChevronDown className="size-4 shrink-0" />
            </Button>
          </DrawerTrigger>

          <DrawerContent className="border border-border shadow-lg">
            <DrawerHeader>
              <DrawerTitle>마이페이지 메뉴</DrawerTitle>
            </DrawerHeader>

            <div className="grid gap-1 overflow-y-auto p-4">
              {/* 메뉴가 열리거나 링크에 포인터를 올려도 대상 화면을 미리 조회하지 않는다. */}
              {MYPAGE_MENUS.map((menu) => (
                <DrawerClose key={menu.id} asChild>
                  <Button
                    asChild
                    variant={activeMenu.id === menu.id ? "secondary" : "ghost"}
                    className="h-12 justify-between"
                  >
                    <Link
                      href={myPageMenuPath(menu.id)}
                      prefetch={false}
                      aria-current={
                        activeMenu.id === menu.id ? "page" : undefined
                      }
                      onNavigate={
                        activeMenu.id === menu.id ? keepCurrentMenu : undefined
                      }
                    >
                      {menu.label}
                      {/* 현재 경로에 해당하는 메뉴에만 선택 표시를 추가한다. */}
                      {activeMenu.id === menu.id && (
                        <Check className="size-4 shrink-0" />
                      )}
                    </Link>
                  </Button>
                </DrawerClose>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      {/* PC와 모바일에서 동일한 콘텐츠를 사용한다. */}
      <TabsContent
        value={activeMenu.id}
        className="min-w-0"
        aria-label={activeMenu.label}
      >
        {children}
      </TabsContent>
    </Tabs>
  );
}

/**
 * 현재 모바일 메뉴를 다시 누르면 드로어만 닫고 주소와 쿼리를 보존한다.
 * @param event 링크의 클라이언트 탐색을 취소할 수 있는 이벤트.
 */
function keepCurrentMenu(event: { preventDefault(): void }) {
  // 드로어 닫기 클릭과 별개로 중복 라우팅만 취소한다.
  event.preventDefault();
}
