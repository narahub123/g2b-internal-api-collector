"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
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

/** 마이페이지 메뉴 정보. */
type MyPageMenu = {
  id: string;
  label: string;
  content: ReactNode;
};

/** 메뉴 목록과 최초 선택할 메뉴의 식별자. */
type MyPageNavigationProps<T extends readonly [MyPageMenu, ...MyPageMenu[]]> = {
  menus: T;
  defaultMenuId: NoInfer<T[number]["id"]>;
};

/**
 * PC와 모바일에서 공통 메뉴 선택 상태를 관리한다.
 * 화면 크기에 따라 탭과 드로어를 구분하여 제공한다.
 * @param props.menus 표시할 메뉴와 콘텐츠.
 * @param props.defaultMenuId 최초 진입 시 선택할 메뉴.
 * @returns 반응형 메뉴 및 선택된 콘텐츠.
 */
export default function MyPageNavigation<
  T extends readonly [MyPageMenu, ...MyPageMenu[]],
>({ menus, defaultMenuId }: MyPageNavigationProps<T>) {
  // 메뉴 표시 순서와 관계없이 지정된 메뉴를 최초 선택한다.
  const [activeMenuId, setActiveMenuId] = useState<string>(defaultMenuId);

  // 현재 선택된 메뉴 정보를 조회한다.
  const activeMenu = menus.find((menu) => menu.id === activeMenuId) ?? menus[0];

  return (
    <Tabs
      value={activeMenu.id}
      onValueChange={setActiveMenuId}
      className="grid min-w-0 gap-6"
    >
      {/* PC에서는 메뉴를 가로로 배치하고 선택된 메뉴를 강조한다. */}
      <div className="hidden min-w-0 border-b md:block">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-6 rounded-none bg-transparent p-0">
          {menus.map((menu) => (
            <TabsTrigger
              key={menu.id}
              value={menu.id}
              className="flex-none rounded-none border-0 border-b-2 border-transparent px-2 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
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
              {menus.map((menu) => (
                <DrawerClose key={menu.id} asChild>
                  <Button
                    variant={activeMenu.id === menu.id ? "secondary" : "ghost"}
                    className="h-12 justify-between"
                    aria-current={
                      activeMenu.id === menu.id ? "true" : undefined
                    }
                    onClick={() => setActiveMenuId(menu.id)}
                  >
                    {menu.label}

                    {activeMenu.id === menu.id && (
                      <Check className="size-4 shrink-0" />
                    )}
                  </Button>
                </DrawerClose>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      {/* PC와 모바일에서 동일한 콘텐츠를 사용한다. */}
      {menus.map((menu) => (
        <TabsContent
          key={menu.id}
          value={menu.id}
          className="min-w-0"
          aria-label={menu.label}
        >
          {menu.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
