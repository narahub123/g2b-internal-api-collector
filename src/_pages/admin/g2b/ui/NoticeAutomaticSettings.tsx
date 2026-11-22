"use client";

import { businessFetch } from "@/features/service-auth/business-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { decodeHTMLStrict } from "entities";
import { noticePath } from "@/_pages/admin/config/routes";
import {
  noticeAutomaticIntervals,
  noticeKoreanMinute,
  type NoticeAutomaticCommand,
  type NoticeAutomaticInterval,
  type NoticeAutomaticSettings as Settings,
} from "@/features/collect-g2b/model/notice-automatic";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { NoticeCollectionCounts } from "./NoticeCollectionCounts";
import { NoticeCollectionList } from "./NoticeCollectionList";
import { NoticeCollectionPanel } from "./NoticeCollectionPanel";

const endpoint = "/api/g2b/notice-queue/automatic";
const queryKey = [endpoint] as const;
const statuses = {
  stopped: "중단",
  stopping: "중단 요청됨",
  scheduled: "정기 실행 대기",
  pending: "수집 대기",
  running: "수집 진행 중",
  maintenance: "나라장터 점검 대기",
  queue_paused: "전체 큐 일시 중단",
};
const intervals = { 30: "30분", 60: "1시간", 120: "2시간" };

function refreshInterval(settings?: Settings) {
  if (settings && (settings.counts.running > 0 || ["pending", "running", "stopping"].includes(settings.status))) {
    return 5_000;
  }
  return 30_000;
}

/** 자동 수집 일정을 관리하고 공고 집계와 상태별 목록을 확인한다. */
export function NoticeAutomaticSettings() {
  const [open, setOpen] = useState(false);
  const [startMinute, setStartMinute] = useState("");
  const queryClient = useQueryClient();
  const settings = useQuery<Settings>({
    queryKey,
    enabled: open,
    refetchInterval: (query) => open ? refreshInterval(query.state.data) : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: open ? "always" : false,
    queryFn: async ({ signal }) => {
      const response = await businessFetch(endpoint, { signal, cache: "no-store" });
      if (!response.ok)
        throw new Error("자동 수집 상태를 불러오지 못했습니다.");
      return response.json();
    },
  });
  const update = useMutation({
    mutationFn: async (command: NoticeAutomaticCommand): Promise<Settings> => {
      const response = await businessFetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "자동 수집 설정을 변경하지 못했습니다.");
      }
      return response.json();
    },
    onSuccess: async (result, command) => {
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, result);
      if (command.action === "start") setStartMinute("");
    },
  });
  const current = settings.data;
  const notice = current?.currentNotice;
  const title = notice ? decodeHTMLStrict(notice.title) || "공고명 미확인" : "";

  return (
    <NoticeCollectionPanel
      title="자동 수집 설정"
      open={open}
      onOpenChange={setOpen}
    >
      <div className="space-y-3">
        {settings.isError && <p role="alert">{settings.error.message}</p>}
        {update.isError && <p role="alert">{update.error.message}</p>}
        {settings.isPending && (
          <p role="status">자동 수집 상태를 불러오는 중입니다.</p>
        )}
        {current && (
          <>
            <dl
              className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[220px_minmax(0,1fr)]"
              aria-live="polite"
            >
              <div className="flex min-w-0 items-center gap-3">
                <dt className="shrink-0 text-muted-foreground">현재 상태</dt>
                <dd className="font-medium">{statuses[current.status]}</dd>
              </div>

              <div className="flex min-w-0 items-center gap-3">
                <dt className="shrink-0 text-muted-foreground">
                  다음 정기 실행 (한국 시각)
                </dt>
                <dd className="font-medium tabular-nums">
                  {current.nextAt === null
                    ? "—"
                    : noticeKoreanMinute(current.nextAt).replace("T", " ")}
                </dd>
              </div>
            </dl>

            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (current.enabled) {
                  update.mutate({ action: "stop" });
                } else if (startMinute) {
                  update.mutate({
                    action: "start",
                    interval: current.interval,
                    startMinute,
                  });
                }
              }}
            >
              <label className="flex items-center gap-3 text-sm">
                <span className="shrink-0">수집 주기</span>
                <select
                  className="h-9 rounded-md border bg-background px-3"
                  value={current.interval}
                  disabled={update.isPending}
                  onChange={(event) =>
                    update.mutate({
                      action: "interval",
                      interval: Number(
                        event.target.value,
                      ) as NoticeAutomaticInterval,
                    })
                  }
                >
                  {noticeAutomaticIntervals.map((interval) => (
                    <option key={interval} value={interval}>
                      {intervals[interval]}
                    </option>
                  ))}
                </select>
              </label>

              {!current.enabled && (
                <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
                  <span className="shrink-0">시작 시각 (한국 시각)</span>
                  <Input
                    type="datetime-local"
                    step={60}
                    required
                    value={startMinute}
                    disabled={update.isPending}
                    onChange={(event) => setStartMinute(event.target.value)}
                    className="w-full sm:w-auto"
                  />
                </label>
              )}

              <Button
                type="submit"
                variant={current.enabled ? "outline" : "default"}
                className={
                  current.enabled
                    ? "w-full border-transparent text-destructive hover:border-destructive hover:bg-destructive hover:text-white sm:ml-auto sm:w-auto"
                    : "w-full sm:ml-auto sm:w-auto"
                }
                disabled={update.isPending}
              >
                {current.enabled
                  ? "자동 수집 중단"
                  : current.startMinute
                    ? "자동 수집 재개"
                    : "자동 수집 시작"}
              </Button>
            </form>
            {current.round && (
              <p className="text-sm text-muted-foreground">
                기준 회차{" "}
                <span className="font-medium tabular-nums">{current.round.startMinute.replace("T", " ")} ~{" "}{current.round.endMinute.replace("T", " ")}</span>
              </p>
            )}
            <NoticeCollectionCounts counts={current.counts} />
            <div className="flex h-8 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-sm">
              <span className="shrink-0 text-muted-foreground">
                현재 수집 중
              </span>
              {notice ? (
                <Link
                  href={noticePath(notice)}
                  prefetch={false}
                  className="flex min-w-0 items-center gap-2 hover:underline"
                >
                  <span className="min-w-0 truncate" title={title}>
                    {title}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {notice.number} · {notice.revision}
                  </span>
                </Link>
              ) : (
                <span className="truncate">수집 중인 공고 없음</span>
              )}
            </div>
            {(["all", "failed"] as const).map((kind) => (
              <NoticeCollectionList
                key={kind}
                scope="automatic"
                kind={kind}
                panelOpen={open}
                roundId={current.round?.walkId}
                failedCount={current.counts.failed}
                pollInterval={
                  current.status === "stopped"
                    ? false
                    : refreshInterval(current)
                }
              />
            ))}
          </>
        )}
      </div>
    </NoticeCollectionPanel>
  );
}
