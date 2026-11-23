"use client";

import { useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { logout } from "./page-actions";
import { withSessionCookieWrite } from "./session-writes";

/**
 * 로그아웃 확인 후 현재 브라우저의 세션을 종료한다.
 * 기존 세션 쿠키 쓰기 순서 보장 로직을 유지한다.
 */
export function LogoutForm() {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={logout}
      onSubmit={(event) => {
        event.preventDefault();

        if (!pending) {
          startTransition(() => withSessionCookieWrite(logout));
        }
      }}
    >
      <Button type="submit" variant="destructive" disabled={pending} className="w-full">
        {pending ? "로그아웃 중..." : "로그아웃"}
      </Button>
    </form>
  );
}
