"use client";

import { THEME_LABELS } from "@/shared/lib/theme";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { useTheme } from "@/shared/ui/theme-provider";

// 키보드 초점은 두 테마에서 배경색 변화와 별개로 확인할 수 있게 표시한다.
const themeFocus = "focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring";

/**
 * 현재 테마 이름을 버튼에 표시하고 메뉴에서 라이트·다크·시스템 중 하나를 선택하게 한다.
 * @returns 키보드 탐색과 선택 상태를 제공하는 테마 메뉴.
 */
export function ThemeMenu() {
  // 현재 선택값과 문서에 새 테마를 적용할 변경 동작을 가져온다.
  const { theme, selectTheme } = useTheme();

  // 공통 드롭다운으로 포커스 이동과 선택 상태를 제공한다.
  return (
    <DropdownMenu>
      {/* 메뉴가 닫혀 있어도 현재 설정을 확인할 수 있게 테마 이름을 표시한다. */}
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={themeFocus} aria-label={`테마 설정: ${THEME_LABELS[theme]}`}>
          {THEME_LABELS[theme]}
        </Button>
      </DropdownMenuTrigger>
      {/* 펼친 메뉴에서 테마 하나만 선택되며 선택 즉시 설정을 적용한다. */}
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={selectTheme}>
          {/* 각 테마는 현재 선택과 키보드 초점을 별도로 표시한다. */}
          <DropdownMenuRadioItem value="light" className={themeFocus}>{THEME_LABELS.light}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className={themeFocus}>{THEME_LABELS.dark}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" className={themeFocus}>{THEME_LABELS.system}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
