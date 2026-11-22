"use client";

import { useActionState } from "react";
import { handleBusinessFailure } from "@/features/service-auth/business-client";
import { withSessionCookieWrite } from "@/features/service-auth/session-writes";
import type { BusinessAuthFailure } from "@/shared/model/business-auth";

/** 파일 한 건의 수동 등록 상태를 같은 행에 표시한다. */
export function AttachmentRequestForm({ action, label }: {
  action: (state: string, form: FormData) => Promise<string | BusinessAuthFailure>; label: string;
}) {
  const [result, submit, pending] = useActionState(async (state: string, form: FormData) => {
    const outcome = await withSessionCookieWrite(() => action(state, form));
    if (typeof outcome === "string") return outcome;
    handleBusinessFailure(outcome);
    return outcome.error;
  }, "");
  return (
    <form action={submit} className="flex flex-wrap items-center gap-2">
      <input type="password" name="token" aria-label="첨부 처리 관리자 토큰" placeholder="관리자 토큰"
        autoComplete="off" required className="rounded-md border px-2 py-1" />
      <button type="submit" disabled={pending} className="rounded-md border px-2 py-1 disabled:opacity-50">
        {pending ? "요청 중" : label}
      </button>
      <span role="status" className="wrap-anywhere text-sm">{result}</span>
    </form>
  );
}
