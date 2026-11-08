import type { ReactNode } from 'react';
import { AccordionContent, AccordionItem, AccordionTrigger } from './accordion';

/**
 * 상세 화면의 아코디언에 제목과 본문을 가진 섹션을 추가한다.
 * @param props 아코디언 내에서 고유한 제목, 본문, 제목 수준.
 * @returns 상세 화면용 아코디언 항목.
 */
export function DetailAccordionSection({ title, children, heading = 'h2' }: {
  title: string;
  children: ReactNode;
  heading?: 'h2' | 'h3';
}) {
  return (
    <AccordionItem value={title} className="min-w-0">
      <AccordionTrigger heading={heading} className="w-full cursor-pointer items-center px-2 text-base font-semibold hover:bg-accent hover:no-underline">
        {title}
      </AccordionTrigger>
      <AccordionContent className="px-2">{children}</AccordionContent>
    </AccordionItem>
  );
}
