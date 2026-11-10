"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "./button";
import { RefreshCw } from "lucide-react";

/**
 * 저장된 상세 자료의 재수집을 요청하고, 성공하면 현재 페이지의 서버 데이터를 갱신한다.
 *
 * 재수집 중에는 중복 요청을 막기 위해 버튼을 비활성화하며, 요청 실패 시 오류를 표시한다.
 * `compact`는 제목 영역의 반응형 버튼에 사용하며, 기본값은 기존 텍스트 버튼을 유지한다.
 *
 * @param props 수집 요청 주소, 최초 수집 여부, 선택적 요청 본문 및 버튼 표시 방식
 * @returns 수집 진행 상태와 실패 메시지를 포함한 재수집 버튼
 */
export function RecollectButton({
  endpoint,
  initial = false,
  requestBody,
  compact = false,
}: {
  endpoint: string;
  initial?: boolean;
  requestBody?: Record<string, string>;
  /** 모바일에서는 아이콘+문구, sm 이상에서는 아이콘만 표시한다. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState("");
  const busy = submitting || refreshing;
  const label = busy ? "수집 중…" : initial ? "수집" : "재수집";

  /**
   * 수집 API에 POST 요청을 보내고 성공 시 페이지를 갱신한다.
   * 요청이 실패하면 오류를 화면에 표시하며, 완료 여부와 관계없이 요청 중 상태를 해제한다.
   */
  async function recollect() {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        ...(requestBody && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "수집 요청에 실패했습니다.");
      }
      startTransition(() => router.refresh());
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "수집 요청에 실패했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid shrink-0 gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={recollect}
        title={compact ? label : undefined}
        aria-label={compact ? label : undefined}
        className={compact ? "gap-2 sm:w-9 sm:px-0" : undefined}
      >
        {/* 제목 영역에서는 모바일에 문구를 표시하고, sm 이상에서는 아이콘만 유지한다. */}
        {compact && (
          <RefreshCw
            aria-hidden="true"
            className={`size-4 shrink-0 ${busy ? "animate-spin" : ""}`}
          />
        )}
        <span className={compact ? "sm:hidden" : undefined}>{label}</span>
      </Button>
      {error && (
        <p role="alert" className="max-w-36 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
