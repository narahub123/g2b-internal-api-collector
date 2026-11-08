import { Button } from '@/shared/ui/button';
import type { Notice, NoticeKey } from '../model/types';

export function NoticeList({ notices, current, onSelect }: {
  notices: Notice[];
  current?: Notice;
  onSelect: (key: NoticeKey) => void;
}) {
  if (notices.length === 0) return <p className="text-sm text-muted-foreground">저장된 공고가 없습니다.</p>;

  return (
    <ul className="grid gap-2">
      {notices.map((notice) => (
        <li key={`${notice.number}/${notice.revision}`}>
          <Button type="button" variant={current === notice ? 'secondary' : 'outline'}
            className="h-auto min-h-9 w-full justify-start whitespace-normal text-left"
            aria-pressed={current === notice}
            onClick={() => onSelect({ number: notice.number, revision: notice.revision })}>
            {notice.title} ({notice.number}/{notice.revision})
          </Button>
        </li>
      ))}
    </ul>
  );
}
