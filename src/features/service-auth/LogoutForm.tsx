"use client";

import { useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { logout } from "./page-actions";
import { withSessionCookieWrite } from "./session-writes";
import { MYPAGE_USER_DATA_KEY } from "./mypage-user-data-query";

/**
 * 로그아웃 확인 후 현재 브라우저의 세션을 종료한다.
 * 기존 세션 쿠키 쓰기 순서 보장 로직을 유지한다.
 */
export function LogoutForm() {
  const [pending, startTransition] = useTransition();
  // 기존 Provider에서 로그인 사용자에게만 보이는 업무 캐시를 정리한다.
  const queryClient = useQueryClient();

  return (
    <form
      action={logout}
      onSubmit={(event) => {
        event.preventDefault();

        if (!pending) {
          // 진행 중인 탭 데이터 요청까지 종료한 후 현재 세션을 닫는다.
          queryClient.removeQueries({ queryKey: MYPAGE_USER_DATA_KEY });
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
