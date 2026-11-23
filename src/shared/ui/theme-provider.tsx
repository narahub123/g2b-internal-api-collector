"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { parseTheme, THEME_COOKIE, type Theme } from "@/shared/lib/theme";

/** 테마 메뉴와 알림이 공유하는 브라우저 설정. */
type ThemeContextValue = {
  /** 사용자가 선택한 테마이며 시스템 모드에서는 운영체제의 현재 색상과 구분한다. */
  theme: Theme;
  /** 메뉴의 선택값을 문서와 브라우저 쿠키에 반영한다. */
  selectTheme: (value: string) => void;
};

// 테마를 제공하는 레이아웃 밖에서 사용한 경우를 확인할 수 있도록 초기값을 비워 둔다.
const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * 첫 화면에 적용된 서버 테마로 상태를 초기화하고 이후 사용자의 선택을 문서와 쿠키에 반영한다.
 * @param props 서버에서 확인한 테마와 설정을 공유할 화면 및 알림.
 * @param props.initialTheme 요청 쿠키에서 확인한 테마.
 * @param props.children 테마를 공유할 하위 화면과 알림.
 * @returns 하위 구성 요소에 테마를 제공하는 컨텍스트.
 */
export function ThemeProvider({ initialTheme, children }: { initialTheme: Theme; children: ReactNode }) {
  // 서버에서 렌더링한 선택값으로 시작해 첫 화면과 메뉴 상태를 일치시킨다.
  const [theme, setTheme] = useState(initialTheme);

  /**
   * 메뉴 선택값을 검증해 즉시 화면에 적용하고, 이후 요청에도 이어지도록 브라우저에 저장한다.
   * @param value 메뉴에서 선택한 테마 값.
   */
  function selectTheme(value: string) {
    // 문서 속성에는 허용된 테마 이름만 기록한다.
    const selected = parseTheme(value);
    // 스타일을 즉시 전환하고 메뉴와 알림의 선택 상태를 갱신한다.
    document.documentElement.dataset.theme = selected;
    setTheme(selected);
    // 로그인 전후와 모든 경로에서 같은 설정을 1년간 사용한다.
    document.cookie = `${THEME_COOKIE}=${selected}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  // 메뉴와 알림이 동일한 선택값을 사용할 수 있도록 하위 트리에 제공한다.
  return <ThemeContext.Provider value={{ theme, selectTheme }}>{children}</ThemeContext.Provider>;
}

/**
 * 루트 레이아웃이 제공하는 테마 선택값과 변경 동작을 읽는다.
 * @returns 현재 선택값과 메뉴 선택을 반영하는 함수.
 * @throws 테마 제공자 바깥에서 호출한 경우 레이아웃 구성 오류를 전달한다.
 */
export function useTheme() {
  // 현재 문서의 테마를 관리하는 컨텍스트를 조회한다.
  const context = useContext(ThemeContext);
  // 설정을 공유할 수 없는 구성에서는 잘못된 초기값으로 진행하지 않는다.
  if (!context) {
    // 테마 제공자 누락을 호출 화면에 알린다.
    throw new Error("테마 제공자를 찾을 수 없습니다.");
  }
  // 호출 화면이 선택값을 읽거나 변경할 수 있도록 설정을 반환한다.
  return context;
}
