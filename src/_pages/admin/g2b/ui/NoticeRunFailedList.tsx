import { noticePath } from "@/_pages/admin/config/routes";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shared/ui/accordion";
import type { NoticeRun } from "@/server/g2b/repository/notice-queue-types";

import { NoticeRunNoticeRow } from "./NoticeRunNoticeRow";

type NoticeRunFailedListProps = {
  notices: NoticeRun["notices"];
};

/** 기간 수집 결과에 최종 실패가 있을 때 실패 공고와 건수를 접이식 목록으로 표시한다. */
export function NoticeRunFailedList({ notices }: NoticeRunFailedListProps) {
  const failedNotices = notices.filter((notice) => notice.status === "failed");

  if (failedNotices.length === 0) return null;

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="failed-notices">
        <AccordionTrigger className="cursor-pointer hover:no-underline">
          <span className="flex items-center gap-2">
            수집 실패 목록
            <span className="text-sm text-destructive">
              ({failedNotices.length}건)
            </span>
          </span>
        </AccordionTrigger>

        <AccordionContent>
          <ul className="divide-y">
            {failedNotices.map((notice) => (
              <NoticeRunNoticeRow key={noticePath(notice)} notice={notice} />
            ))}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
