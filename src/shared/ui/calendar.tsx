"use client";

import { DayPicker } from "react-day-picker";
import type { ComponentProps } from "react";
import { buttonVariants } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

/** shadcn 버튼과 테마 색상으로 달력을 표시하고 날짜 이동과 키보드 탐색은 DayPicker에 맡긴다. */
export function Calendar({ className, classNames, ...props }: ComponentProps<typeof DayPicker>) {
  const navigationButton = cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "bg-transparent [&_svg]:size-4");

  return (
    <DayPicker
      showOutsideDays
      className={cn("w-fit text-sm", className)}
      classNames={{
        months: "relative",
        month: "grid gap-2",
        month_caption: "flex h-8 items-center justify-center px-9 font-medium",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: navigationButton,
        button_next: navigationButton,
        chevron: "fill-current",
        month_grid: "border-collapse",
        weekday: "h-8 text-center text-xs font-normal text-muted-foreground",
        day: "group/day p-0 text-center",
        day_button: cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "text-sm font-normal group-data-[selected=true]/day:bg-primary group-data-[selected=true]/day:text-primary-foreground",
        ),
        today: "rounded-md bg-accent text-accent-foreground",
        outside: "text-muted-foreground",
        disabled: "opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      {...props}
    />
  );
}
