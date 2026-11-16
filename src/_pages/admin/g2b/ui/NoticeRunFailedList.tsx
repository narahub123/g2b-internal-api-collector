import Link from "next/link";
import { decodeHTMLStrict } from "entities";
import { noticePath } from "@/_pages/admin/config/routes";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shared/ui/accordion";
import type { NoticeRun } from "@/server/g2b/repository/notice-queue-types";

type NoticeRunFailedListProps = {
  notices: NoticeRun["notices"];
};

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
              <li key={noticePath(notice)}>
                <Link
                  href={noticePath(notice)}
                  prefetch={false}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-sm px-2 py-2 hover:bg-muted focus-visible:outline-ring sm:gap-4"
                >
                  <span
                    className="truncate"
                    title={decodeHTMLStrict(notice.title)}
                  >
                    {decodeHTMLStrict(notice.title) || "공고명 미확인"}
                  </span>

                  <span className="tabular-nums">{notice.number}</span>

                  <span aria-label={`차수 ${notice.revision}`}>
                    {notice.revision}
                  </span>

                  <span className="text-destructive">실패</span>
                </Link>

                {notice.error && (
                  <p className="break-all px-2 pb-2 text-xs text-destructive">
                    {notice.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
