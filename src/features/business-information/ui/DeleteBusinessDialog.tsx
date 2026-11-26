"use client";

import { useState, useTransition } from "react";
import { formatBusinessNumber } from "@/entities/business/model/business-display";
import { withSessionCookieWrite } from "@/features/service-auth/session-writes";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { deleteMyBusiness } from "../actions";

/**
  * 목록 또는 상세에서 선택한 사업자를 삭제하기 전에 명시적 확인을 받는다.
  * @param props 확인창에 표시할 업체명, 사업자등록번호, 내부 ID와 호출 화면.
  * @returns 해당 사업자의 삭제 버튼과 상태를 표시하는 확인창.
  */
export function DeleteBusinessDialog({ id, name, number, source = "list" }: {
  /** 현재 화면에서 선택한 사업자의 내부 ID. */
  id: number;
  /** 기본정보에서 확인한 업체명. */
  name: string | null;
  /** 선택한 사업자의 원본 등록번호. */
  number: string;
  /** 삭제 성공 후 목록으로 이동할지 결정하는 화면. */
  source?: "list" | "detail";
}) {
  // 확인창 표시, 삭제 처리 중 여부와 다시 시도할 때 보여줄 오류를 관리한다.
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  // 삭제 버튼과 확인창에서 같은 사업자를 식별할 수 있게 한다.
  const label = name ? `${name} (${formatBusinessNumber(number)})` : formatBusinessNumber(number);

  /**
   * 대화상자 열기와 취소를 처리하고 새로운 확인에서는 이전 오류를 지운다.
   * @param nextOpen 대화상자가 요청하는 표시 상태.
   */
  function changeOpen(nextOpen: boolean) {
    // 요청이 진행 중이면 취소나 Escape로 진행 상태를 숨기지 않는다.
    if (pending) return;
    // 새 확인창에 직전 시도의 오류가 남지 않도록 한다.
    if (nextOpen) setError("");
    setOpen(nextOpen);
  }

  /** 사용자가 확인한 대상만 서버에서 삭제하고 처리 결과를 화면에 반영한다. */
  function confirm() {
    // 처리 중에는 같은 작업을 반복하지 않고 이전 오류를 지운다.
    if (pending) return;
    setError("");

    // 기존 세션 요청과 같은 직렬화 경로에서 삭제 결과를 기다린다.
    startTransition(async () => {
      try {
        // 서버는 표시 당시 번호와 현재 로그인 사용자의 연결을 검증한다.
        const message = await withSessionCookieWrite(() => deleteMyBusiness(String(id), number, source));
        // 실패 시 확인창을 유지해 같은 대상으로 다시 시도할 수 있게 한다.
        if (message) {
          setError(message);
          return;
        }
        // 삭제 성공 시 확인창을 닫으며 목록은 액션에서 갱신한다.
        setOpen(false);
      } catch {
        // 통신 실패에도 내부 오류를 노출하지 않고 재시도를 안내한다.
        setError("삭제 요청을 완료하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  }

  // 상세 탐색과 별개의 버튼으로 확인을 열고 명시적 확인에만 서버 요청을 연결한다.
  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm" aria-label={`${label} 삭제`}>삭제</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle className="font-semibold">사업자 등록을 삭제하시겠습니까?</AlertDialogTitle>
        <AlertDialogDescription className="break-words text-sm text-muted-foreground">
          {label}의 등록을 삭제합니다.
        </AlertDialogDescription>
        {/* 오류가 있으면 보조 기술에도 알리고 사용자가 다시 확인할 수 있게 한다. */}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {/* 취소에서는 서버 요청 없이 확인창만 닫는다. */}
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={pending}>취소</Button>
          </AlertDialogCancel>
          {/* 확인한 경우에만 연결 삭제를 요청한다. */}
          <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
            {pending ? "삭제 중…" : "삭제 확인"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
