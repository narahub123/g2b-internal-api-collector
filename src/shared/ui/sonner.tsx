"use client";

import { useSyncExternalStore } from "react";
import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "@/shared/ui/theme-provider";

// 문서 CSS와 동일한 시스템 다크 모드 조건을 사용한다.
const darkColorScheme = "(prefers-color-scheme: dark)";

/**
 * 열린 화면의 시스템 색상 변경을 구독하고 알림이 제거되면 연결을 정리한다.
 * @param notify 브라우저 색상이 변경되었을 때 React에 알릴 함수.
 * @returns 브라우저 이벤트 연결을 해제하는 함수.
 */
function subscribeToSystemTheme(notify: () => void) {
  // 브라우저의 색상 설정을 관찰하고 변경 시 스냅샷을 다시 읽게 한다.
  const media = window.matchMedia(darkColorScheme);
  media.addEventListener("change", notify);
  /**
   * 알림 컨테이너의 구독이 끝났을 때 이 구독이 등록한 브라우저 이벤트를 해제한다.
   */
  function unsubscribe() {
    // 제거된 알림 컨테이너가 운영체제 변경을 받지 않도록 구독을 정리한다.
    media.removeEventListener("change", notify);
  }
  // React가 구독 종료 시 이벤트 연결을 해제할 수 있게 정리 함수를 반환한다.
  return unsubscribe;
}

/**
 * 브라우저에서 운영체제의 현재 색상 설정을 읽는다.
 * @returns 운영체제가 다크 모드이면 참.
 */
function readSystemDarkMode() {
  // CSS가 사용하는 조건과 일치하는지 확인한다.
  return window.matchMedia(darkColorScheme).matches;
}

/**
 * 브라우저 설정을 조회하기 전 서버와 초기 연결에서 사용할 스냅샷을 제공한다.
 * @returns 알림 초기값에 사용할 라이트 모드 상태.
 */
function readServerDarkMode() {
  // 연결이 끝나면 브라우저 스냅샷으로 시스템 알림 색을 갱신한다.
  return false;
}

/**
 * 사용자 선택과 시스템 색상을 확인해 현재 화면과 같은 알림 팔레트를 적용한다.
 * @returns 서비스 전역 Sonner 알림 컨테이너.
 */
export function Toaster() {
  // 메뉴와 문서에 적용된 사용자 선택값을 조회한다.
  const { theme } = useTheme();
  // 운영체제 설정이 바뀌면 시스템 테마의 알림 색을 갱신한다.
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, readSystemDarkMode, readServerDarkMode);
  // 수동 선택을 우선하고 시스템 모드에서는 운영체제 설정을 사용한다.
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  // 일반 알림은 공통 팝오버 색을 사용하고 상태 알림은 Sonner의 테마 색을 사용한다.
  return (
    <SonnerToaster theme={resolvedTheme} richColors position="bottom-right" style={{
      "--normal-bg": "var(--popover)", "--normal-text": "var(--popover-foreground)",
      "--normal-border": "var(--border)",
    } as React.CSSProperties} />
  );
}
