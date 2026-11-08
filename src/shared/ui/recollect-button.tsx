'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from './button';

/**
 * 현재 상세 자료를 수집하고 페이지를 새 결과로 갱신한다.
 * @param props 대상 자료의 POST 경로, 최초 수집 여부, 필요한 경우 JSON 요청 본문.
 * @returns 수집 진행 상태와 오류를 표시하는 버튼.
 */
export function RecollectButton({ endpoint, initial = false, requestBody }: {
  endpoint: string;
  initial?: boolean;
  requestBody?: Record<string, string>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState('');
  const busy = submitting || refreshing;

  async function recollect() {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        ...(requestBody && {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || '수집 요청에 실패했습니다.');
      }
      startTransition(() => router.refresh());
    } catch (error) {
      setError(error instanceof Error ? error.message : '수집 요청에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid shrink-0 gap-1">
      <Button type="button" variant="outline" disabled={busy} onClick={recollect}>
        {busy ? '수집 중…' : initial ? '수집' : '재수집'}
      </Button>
      {error && <p role="alert" className="max-w-36 text-xs text-destructive">{error}</p>}
    </div>
  );
}
