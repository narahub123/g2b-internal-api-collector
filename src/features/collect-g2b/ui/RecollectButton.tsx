"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { waitForNoticeJob } from "../api/wait-for-notice-job";
import { Button } from "@/shared/ui/button";
import { RefreshCw } from "lucide-react";
import { orderPlanUnavailableMessage, orderPlanUnprocessableStatus } from "@/shared/config/g2b-order-plan";

/**
 * 재수집을 요청하고 성공하면 현재 페이지의 서버 데이터를 갱신한다.
 * 실패 목록에서는 새 실패 이력을 반영하도록 실패 시에도 페이지를 갱신할 수 있다.
 *
 * 재수집 중에는 중복 요청을 막기 위해 버튼을 비활성화하며, 요청 실패 시 오류를 표시한다.
 * 발주계획 미존재는 상태 안내로 표시한다. `compact`에서는 안내를 버튼 아래에 겹쳐 표시한다.
 *
 * @param props 수집 요청 주소, 최초 수집 여부, 선택적 요청 본문 및 버튼 표시 방식
 * @returns 수집 진행 상태와 실패 메시지를 포함한 재수집 버튼
 */
export function RecollectButton({
  endpoint,
  initial = false,
  requestBody,
  compact = false,
  refreshOnError = false,
}: {
  endpoint: string;
  initial?: boolean;
  requestBody?: Record<string, string>;
  /** 모바일에서는 아이콘+문구, sm 이상에서는 아이콘만 표시한다. */
  compact?: boolean;
  refreshOnError?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [jobId, setJobId] = useState<number>();
  const requestController = useRef<AbortController>(null);
  useEffect(() => () => requestController.current?.abort(), []);
  const busy = submitting || refreshing;
  const actionLabel = initial ? "수집" : "재수집";
  const label = busy ? "수집 중…" : actionLabel;

  /**
   * 수집 API에 POST 요청을 보내고 저장 성공 시 페이지를 갱신한다. 발주계획 미존재는 현재 화면에 안내한다.
   * 요청이 실패하면 오류를 화면에 표시하며, 완료 여부와 관계없이 요청 중 상태를 해제한다.
   */
  async function recollect() {
    setSubmitting(true);
    const controller = new AbortController();
    requestController.current = controller;
    setError("");
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        ...(requestBody && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "수집 요청에 실패했습니다.");
      }
      if (response.status === 200) {
        const data = await response.json().catch(() => null);
        if (data?.status === orderPlanUnprocessableStatus) {
          setMessage(orderPlanUnavailableMessage);
          return;
        }
      }
      await waitForNoticeJob(response, setJobId, controller.signal);
      startTransition(() => router.refresh());
    } catch (error) {
      if (controller.signal.aborted) return;
      setError(
        error instanceof Error ? error.message : "수집 요청에 실패했습니다.",
      );
      if (refreshOnError) startTransition(() => router.refresh());
    } finally {
      setJobId(undefined);
      setSubmitting(false);
    }
  }

  return (
    <div className={compact ? "relative shrink-0" : "grid shrink-0 gap-1"}>
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
        <span className={compact ? "sm:hidden" : undefined}>{compact ? actionLabel : label}</span>
      </Button>
      {(jobId || error || message) && (
        <div className={compact
          ? "absolute top-full left-1/2 z-10 mt-1 w-max max-w-52 -translate-x-1/2 rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm"
          : "grid gap-1"}>
          {jobId && <p role="status" className="text-sm">수집 작업 {jobId} 접수됨</p>}
          {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
          {error && (
            <p role="alert" className="max-w-36 wrap-anywhere text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
