"use client";

import type { ComponentProps } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/shared/lib/utils";

/** 일반 대화상자의 열림 상태, 제목 및 설명을 공통 UI로 제공한다. */
export const { Root: Dialog, Trigger: DialogTrigger, Close: DialogClose, Title: DialogTitle, Description: DialogDescription } = DialogPrimitive;

/**
 * 포털 안에 대화상자와 배경을 표시하고 키보드 포커스 이동은 Radix에 맡긴다.
 * @param props 대화상자 콘텐츠와 선택 스타일.
 * @returns 뷰포트에 맞춘 공통 대화상자 본문.
 */
export function DialogContent({ className, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      {/* 대화상자와 상호작용하는 동안 배경을 구분해 표시한다. */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        className={cn("fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg", className)}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}
