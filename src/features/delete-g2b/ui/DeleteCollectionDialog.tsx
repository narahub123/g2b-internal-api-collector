"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import type { CollectionDeletionTarget } from "@/server/g2b/repository/collection-deletion";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { deleteCollection } from "../actions/delete-collection";
import { handleBusinessFailure } from "@/features/service-auth/business-client";
import { withSessionCookieWrite } from "@/features/service-auth/session-writes";

type Props = {
  section: CollectionSection;
  targets: CollectionDeletionTarget[];
  trigger: ReactNode;
  description: string;
  onOpen?: () => void;
  onDeleted: (result: { hasOtherOpeningResults: boolean }) => void;
  children?: ReactNode;
};

/**
 * 확인을 받은 뒤 삭제하고, 실패하면 확인창에서 사유를 표시한다.
 * 개찰차수 선택처럼 확인에 필요한 추가 입력을 본문으로 받을 수 있다.
 */
export function DeleteCollectionDialog({
  section, targets, trigger, description, onOpen, onDeleted, children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function confirm() {
    if (pending || !targets.length) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await withSessionCookieWrite(() => deleteCollection(section, targets));
        if (result.ok === false) {
          if ("auth" in result) handleBusinessFailure(result);
          setError(result.error);
          return;
        }
        setOpen(false);
        onDeleted(result);
      } catch {
        setError("삭제 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => {
      if (pending) return;
      if (nextOpen) {
        setError("");
        onOpen?.();
      }
      setOpen(nextOpen);
    }}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <div className="space-y-2">
          <AlertDialogTitle className="text-lg font-semibold">수집 데이터 삭제</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            {description} 선택한 대상의 저장 데이터와 모든 수집 시도 이력이 삭제됩니다.
          </AlertDialogDescription>
        </div>
        {children && <fieldset disabled={pending}>{children}</fieldset>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={pending}>취소</Button>
          </AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={pending || !targets.length} onClick={confirm}>
            {pending ? "삭제 중…" : "삭제"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
