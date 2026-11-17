import Link from "next/link";
import { decodeHTMLStrict } from "entities";
import { noticePath } from "@/_pages/admin/config/routes";
import type { NoticeRun } from "@/server/g2b/repository/notice-queue-types";
import { noticeRunJobLabels } from "./notice-run-status";

/** 수동·자동 목록에서 공고 상세로 연결하고 최종 실패의 경우 오류 사유를 함께 표시한다. */
export function NoticeRunNoticeRow({ notice }: { notice: NoticeRun["notices"][number] }) {
  // 저장 원본은 유지하고 화면에 표시할 공고명만 디코딩한다.
  const title = decodeHTMLStrict(notice.title);
  const failed = notice.status === "failed";
  return (
    <li>
      <Link href={noticePath(notice)} prefetch={false}
        className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-sm px-2 py-2 hover:bg-muted focus-visible:outline-ring sm:gap-4">
        <span className="truncate" title={title}>{title || "공고명 미확인"}</span>
        <span className="tabular-nums">{notice.number}</span>
        <span aria-label={`차수 ${notice.revision}`}>{notice.revision}</span>
        <span className={failed ? "text-destructive" : "text-muted-foreground"}>
          {noticeRunJobLabels[notice.status]}
        </span>
      </Link>
      {failed && notice.error && <p className="break-all px-2 pb-2 text-xs text-destructive">{notice.error}</p>}
    </li>
  );
}
