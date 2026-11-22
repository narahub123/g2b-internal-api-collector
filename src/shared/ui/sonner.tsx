"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * 인증 오류 등의 공통 알림을 shadcn/ui 스타일과 동일한 테마 변수로 표시한다.
 * @returns 서비스 전역 Sonner 알림 컨테이너.
 */
export function Toaster() {
  return (
    <SonnerToaster richColors position="bottom-right" style={{
      "--normal-bg": "var(--popover)", "--normal-text": "var(--popover-foreground)",
      "--normal-border": "var(--border)",
    } as React.CSSProperties} />
  );
}
