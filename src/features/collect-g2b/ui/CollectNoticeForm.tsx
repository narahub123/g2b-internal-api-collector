'use client';

import type { FormEvent } from 'react';
import type { NoticeKey } from '@/entities/notice';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { useCollectNotice } from '../model/use-collect-notice';

/**
 * 공고번호, 차수와 낙찰방법을 입력받아 수집하고 저장된 공고의 키를 호출자에게 전달한다.
 * 수집 중에는 제출을 막고 오류가 나면 입력값을 유지한 채 안내를 표시한다.
 */
export function CollectNoticeForm({ onCollected }: { onCollected: (key: NoticeKey) => void }) {
  const collection = useCollectNotice(onCollected);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    collection.mutate({
      number: String(fields.get('number')).trim().toUpperCase(),
      revision: String(fields.get('revision')).trim().padStart(3, '0'),
      methodCode: String(fields.get('methodCode')).trim(),
    });
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-1.5 text-sm font-medium">
          공고번호 <Input name="number" required maxLength={30} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          차수 <Input name="revision" required inputMode="numeric" pattern="[0-9]{1,3}" defaultValue="000" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          낙찰방법 코드 <Input name="methodCode" maxLength={30} />
        </label>
        <Button type="submit" disabled={collection.isPending}>
          {collection.isPending ? '수집 중…' : '수집 / 다시 수집'}
        </Button>
      </form>
      {collection.error && <p role="alert" className="mt-3 text-sm text-destructive">{collection.error.message}</p>}
    </Card>
  );
}
