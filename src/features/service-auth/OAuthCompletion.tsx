"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/shared/ui/button";
import { finishOAuth } from "./actions";

/**
 * 검증 요청이 진행 중일 때 완료 버튼의 연속 제출을 막는다.
 * @returns 진행 상태에 따라 문구와 활성 여부가 달라지는 완료 버튼.
 */
function CompletionButton() {
  // 상위 완료 폼의 제출 진행 상태를 읽는다.
  const { pending } = useFormStatus();
  // 처리 중에는 안내를 표시하고 중복 제출을 막는다.
  return <Button type="submit" disabled={pending}>{pending ? "인증을 완료하는 중…" : "계속"}</Button>;
}

/**
 * 콜백을 한 번 제출하고 자동 제출 전에도 키보드로 완료할 수 있게 한다.
 * @returns 자동 시작과 수동 제출을 공유하는 완료 폼.
 */
export function OAuthCompletion() {
  // 완료 액션을 자동으로 제출할 폼 요소를 참조한다.
  const form = useRef<HTMLFormElement>(null);
  // 자동 또는 수동으로 해당 폼을 제출했는지 렌더링 간에 기억한다.
  const submitted = useRef(false);
  /**
   * 화면이 준비되면 수동 제출과 같은 경로로 완료 액션을 시작한다.
   */
  useEffect(() => {
    // 사용자가 이미 제출했으면 자동으로 다시 제출하지 않는다.
    if (submitted.current) return;
    // 폼이 연결된 경우 브라우저의 표준 제출 경로를 실행한다.
    form.current?.requestSubmit();
  }, []);
  // 완료 액션에 연결한 폼에서 자동 제출과 버튼 제출의 중복을 막는다.
  return (
    <form ref={form} action={finishOAuth} onSubmit={
      /**
       * 첫 완료 요청만 서버로 제출한다.
       * @param event 중복이면 기본 동작을 취소할 브라우저의 제출 이벤트.
       */
      (event) => {
      // 두 번째 제출은 서버 액션으로 보내지 않는다.
      if (submitted.current) event.preventDefault();
      // 첫 요청 이후 들어오는 제출을 막도록 상태를 기록한다.
      submitted.current = true;
    }}>
      {/* 자동 제출 전에도 사용자가 직접 완료 요청을 보낼 수 있게 한다. */}
      <CompletionButton />
    </form>
  );
}
