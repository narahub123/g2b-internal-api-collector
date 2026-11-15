import type { ReactNode } from "react";
import { Accordion } from "@/shared/ui/accordion";
import { DetailAccordionSection } from "@/shared/ui/g2b/DetailAccordionSection";

/**
 * 공고정보 값 영역의 상세 섹션을 작은 아코디언으로 표시한다.
 * 섹션마다 상태를 독립적으로 관리하고 처음에는 본문을 펼친다.
 * @param props 값 영역에 표시할 섹션 제목과 본문.
 */
export function OpeningResultFieldSection({ title, children }: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Accordion
      type="multiple"
      defaultValue={[title]}
      className="min-w-0 border-t text-sm [&_button]:py-2 [&_button]:text-sm"
    >
      <DetailAccordionSection title={title} heading="h3">
        {children}
      </DetailAccordionSection>
    </Accordion>
  );
}
