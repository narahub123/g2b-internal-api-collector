import type { ReactNode } from "react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "../accordion";
import { cn } from "@/shared/lib/utils";

/**
 * 상세 화면의 아코디언에 제목과 본문을 가진 섹션을 추가한다.
 * @param props 표시 제목, 본문, 제목 수준, 선택적 고유 값과 전체 제목 툴팁.
 * @returns 상세 화면용 아코디언 항목.
 */
export function DetailAccordionSection({
  title,
  children,
  heading = "h2",
  value = title,
  triggerTitle,
}: {
  title: string;
  children: ReactNode;
  heading?: "h2" | "h3" | "h4";
  value?: string;
  triggerTitle?: string;
}) {
  const titleStyle =
    heading === "h4"
      ? "text-sm font-semibold text-muted-foreground"
      : "text-base font-semibold";
  return (
    <AccordionItem value={value} className="min-w-0">
      <AccordionTrigger
        heading={heading}
        title={triggerTitle}
        className={`w-full cursor-pointer items-center px-2 hover:bg-accent hover:no-underline ${titleStyle}`}
      >
        {title}
      </AccordionTrigger>
      <AccordionContent className="px-2 pt-2">{children}</AccordionContent>
    </AccordionItem>
  );
}
