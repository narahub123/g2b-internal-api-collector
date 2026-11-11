"use client";

import type { ComponentProps } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/shared/lib/utils";

/** 트리거와 입력 영역의 열림 상태를 공유한다. */
export const Popover = PopoverPrimitive.Root;

/** 클릭 또는 키보드로 팝오버를 열고, 닫힐 때 포커스를 받을 기준 요소가 된다. */
export const PopoverTrigger = PopoverPrimitive.Trigger;

/** 입력 영역을 트리거 옆 포털에 배치하고 Radix의 포커스 복귀 동작을 유지한다. */
export function PopoverContent({ className, align = "start", sideOffset = 4, ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn("z-50 w-72 max-h-(--radix-popover-content-available-height) max-w-(--radix-popover-content-available-width) overflow-auto rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
