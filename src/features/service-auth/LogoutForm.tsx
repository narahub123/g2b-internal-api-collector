"use client";

import { useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { logout } from "./page-actions";
import { withSessionCookieWrite } from "./session-writes";

/**
 * 앞서 진행 중인 갱신 결과가 들어온 뒤 현재 브라우저의 로그아웃을 요청한다.
 * @returns 기본 폼 제출과 시작된 쿠키 쓰기의 순서 보장을 제공하는 로그아웃 버튼.
 */
export function LogoutForm() {
  const [pending, startTransition] = useTransition();
  return (
    <form action={logout} onSubmit={
      /**
       * 스크립트가 활성화된 경우 앞선 갱신과 같은 잠금에서 로그아웃을 실행한다.
       * @param event 표준 폼 제출의 중복을 막는 React 이벤트.
       */
      (event) => {
        event.preventDefault();
        if (!pending) startTransition(() => withSessionCookieWrite(logout));
      }
    }>
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>로그아웃</Button>
    </form>
  );
}
