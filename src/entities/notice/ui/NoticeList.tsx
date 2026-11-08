import Link from 'next/link';
import { Button } from '@/shared/ui/button';
import { noticePath } from '../lib/notice-path';
import type { Notice } from '../model/types';

export function NoticeList({ notices }: { notices: Notice[] }) {
  if (notices.length === 0) return <p className="text-sm text-muted-foreground">저장된 공고가 없습니다.</p>;

  return (
    <ul className="grid gap-2">
      {notices.map((notice) => (
        <li key={`${notice.number}/${notice.revision}`}>
          <Button asChild variant="outline" className="h-auto min-h-9 w-full justify-start whitespace-normal text-left">
            <Link href={noticePath(notice)} prefetch={false}>
              {notice.title} ({notice.number}/{notice.revision})
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}
