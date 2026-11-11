"use client";

import type { ComponentProps } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { cn } from "@/shared/lib/utils";

/** 선택 메뉴의 열림 상태와 선택값을 하위 컴포넌트에 공유한다. */
export const Select = SelectPrimitive.Root;

/** 현재 옵션의 라벨을 트리거에 표시하고 선택 전에는 안내 문구를 표시한다. */
export const SelectValue = SelectPrimitive.Value;

/** 선택값과 열기 표시를 보여주며 Radix가 키보드 탐색과 포커스를 관리한다. */
export function SelectTrigger({ children, className, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild><ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

/** 메뉴를 포털에 표시해 상위 컨테이너의 스크롤 영역 밖에서도 선택지를 탐색할 수 있게 한다. */
export function SelectContent({ children, className, ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position="popper"
        sideOffset={4}
        collisionPadding={8}
        className={cn("z-50 max-h-(--radix-select-content-available-height) w-max max-w-(--radix-select-content-available-width) min-w-[min(var(--radix-select-trigger-width),var(--radix-select-content-available-width))] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md", className)}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex justify-center py-1"><ChevronUp className="size-4" /></SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex justify-center py-1"><ChevronDown className="size-4" /></SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

/** 표시 문구와 선택값을 연결하고 현재 선택된 항목에 체크 표시를 붙인다. */
export function SelectItem({ children, className, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn("relative flex cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50", className)}
      {...props}
    >
      <SelectPrimitive.ItemText className="min-w-0 wrap-anywhere">{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
        <Check className="size-4" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
