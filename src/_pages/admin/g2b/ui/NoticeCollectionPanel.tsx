"use client";

import type { ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/shared/ui/accordion";

/** 접혀 있을 때 입력값과 목록 위치를 보존하고, 호출부에 조회 활성 상태를 전달한다. */
export function NoticeCollectionPanel({ title, open, onOpenChange, children }: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Accordion type="single" collapsible value={open ? "panel" : ""}
      onValueChange={(value) => onOpenChange(Boolean(value))}
      className="min-w-0 rounded-lg border bg-card px-4 sm:px-5">
      <AccordionItem value="panel">
        <AccordionTrigger heading="h2" className="cursor-pointer text-lg font-semibold hover:no-underline">
          {title}
        </AccordionTrigger>
        <AccordionContent forceMount hidden={!open}>
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
