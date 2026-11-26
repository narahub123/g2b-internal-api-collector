"use client";

import { useState, useTransition } from "react";
import { formatBusinessNumber } from "@/entities/business/model/business-display";
import { withSessionCookieWrite } from "@/features/service-auth/session-writes";
import { Button } from "@/shared/ui/button";
import { refreshMyBusiness } from "../actions";

/**
 * 목록과 상세에서 같은 사업자의 사업자 정보 갱신을 요청한다.
 * @param props 화면에서 선택한 사업자 ID와 원본 사업자등록번호.
 * @returns 전체 갱신 버튼과 요청 결과 안내.
 */
export function RefreshBusinessButton({ id, number }: { id: number; number: string }) {
  // 처리 중에는 요청을 다시 보내지 않고 완료 후 안내를 표시한다.
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  /** 명시적으로 누른 버튼의 대상에 대해서만 서버 액션을 실행한다. */
  function refresh() {
    // 처리 중 중복 실행을 막고 이번 요청의 결과를 별도로 표시한다.
    if (pending) return;
    setMessage("");
    startTransition(async () => {
      try {
        // 현재 세션과 화면의 식별값으로 전체 갱신을 요청한다.
        setMessage(await withSessionCookieWrite(() => refreshMyBusiness(String(id), number)));
      } catch {
        // 서버에 연결하지 못한 경우 사용자가 다시 실행할 수 있도록 안내한다.
        setMessage("갱신 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    });
  }

  // 스크린 리더에서도 목록의 각 갱신 대상을 구분하고 결과를 전달한다.
  return (
    <div className="grid gap-1">
      <Button type="button" variant="outline" size="sm" className="w-fit" disabled={pending}
        aria-label={`${formatBusinessNumber(number)} 사업자 정보 갱신`} onClick={refresh}>
        {pending ? "갱신 중…" : "사업자 정보 갱신"}
      </Button>
      {/* 완료·부분 실패·전체 실패·진행 중 안내는 요청한 사업자 행에 남긴다. */}
      <span role="status" className={message ? "text-sm text-muted-foreground" : "sr-only"}>{message}</span>
    </div>
  );
}
