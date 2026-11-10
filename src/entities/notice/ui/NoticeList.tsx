import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { noticePath } from "../lib/notice-path";
import type { NoticeSummary } from "../model/types";
import { decodeHTMLStrict } from "entities";

/**
 * 저장된 입찰공고 목록을 표시한다.
 * 공고 제목은 원본 데이터를 변경하지 않고 표시 시점에 HTML 엔티티를 디코딩한다.
 * 각 목록 항목은 해당 공고의 상세 페이지로 연결된다.
 *
 * @param notices 표시할 입찰공고 요약 정보 목록
 * @returns 공고 목록 또는 저장된 공고가 없다는 안내 문구
 */
export function NoticeList({ notices }: { notices: NoticeSummary[] }) {
  if (notices.length === 0)
    return (
      <p className="text-sm text-muted-foreground">저장된 공고가 없습니다.</p>
    );

  return (
    <ul className="grid gap-2">
      {notices.map((notice) => (
        <li key={`${notice.number}/${notice.revision}`}>
          <Button
            asChild
            variant="outline"
            className="h-auto min-h-9 w-full justify-start whitespace-normal text-left"
          >
            <Link href={noticePath(notice)} prefetch={false}>
              {/* 상세 제목과 동일하게 HTML 엔티티를 디코딩하여 표시한다. */}
              {decodeHTMLStrict(notice.title)} ({notice.number}/
              {notice.revision})
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}
