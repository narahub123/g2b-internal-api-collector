"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_LABELS, type Theme } from "@/shared/lib/theme";
import { useTheme } from "@/shared/ui/theme-provider";

type ThemeSelectorProps = {
  /** 화면 테마 제목과 3열 버튼 레이아웃 표시 여부. */
  showLabel?: boolean;
};

/** 화면 테마별 아이콘과 설정값. */
const themeOptions = [
  { value: "light", Icon: Sun },
  { value: "dark", Icon: Moon },
  { value: "system", Icon: Monitor },
] as const satisfies ReadonlyArray<{
  value: Theme;
  Icon: typeof Sun;
}>;

/**
 * 라이트·다크·시스템 테마를 아이콘 버튼으로 선택한다.
 *
 * 로그인 전에는 정사각형 아이콘 버튼만 표시하고,
 * 계정 드롭다운에서는 제목과 균등한 3열 버튼을 표시한다.
 */
export function ThemeSelector({ showLabel = false }: ThemeSelectorProps) {
  const { theme, selectTheme } = useTheme();

  return (
    <div className={showLabel ? "space-y-2" : ""}>
      {showLabel && (
        <div className="text-xs font-medium text-muted-foreground">
          화면 테마
        </div>
      )}

      <div
        role="group"
        aria-label="화면 테마"
        className={
          showLabel
            ? "grid grid-cols-3 gap-2"
            : "flex items-center justify-center gap-2"
        }
      >
        {themeOptions.map(({ value, Icon }) => {
          const selected = theme === value;

          return (
            <button
              key={value}
              type="button"
              title={THEME_LABELS[value]}
              aria-label={THEME_LABELS[value]}
              aria-pressed={selected}
              onClick={() => selectTheme(value)}
              className={[
                "flex h-9 cursor-pointer items-center justify-center",
                "rounded-md border transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2",
                "focus-visible:outline-ring",
                showLabel ? "w-full" : "w-9 shrink-0",
                selected
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              ].join(" ")}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
