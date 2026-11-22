"use client";

import { businessFetch } from "@/features/service-auth/business-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Tabs } from "radix-ui";
import { useEffect, useRef } from "react";
import { noticePath } from "@/_pages/admin/config/routes";
import { Button } from "@/shared/ui/button";
import { ListView } from "@/shared/ui/list-controls/ListView";
import type {
  NoticeJob,
  NoticeQueuePageData,
  NoticeQueueListKind,
  NoticeQueueSummary,
} from "@/server/g2b/repository/notice-queue-types";
import { NoticeCollectionCounts } from "./NoticeCollectionCounts";
import { cn } from "@/shared/lib/utils";

const endpoint = "/api/g2b/notice-queue";
const summaryKey = [endpoint, "summary"] as const;
const tabClass = "cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=active]:bg-muted data-[state=active]:text-foreground";
const labels = {
  pending: "대기",
  retry_wait: "재시도 대기",
  succeeded: "완료",
  failed: "최종 실패",
};

async function readQueue<T>(query: string, signal: AbortSignal): Promise<T> {
  const response = await businessFetch(`${endpoint}?${query}`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error("공고 큐 상태를 불러오지 못했습니다.");
  return response.json();
}

/** 고정 높이에서 현재 작업을 표시한다. 좁은 화면에서는 세부 내용을 가로로 이동해 볼 수 있다. */
function CurrentQueueJob({ job }: { job: NoticeJob | null }) {
  return (
    <div className="flex h-10 min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap text-sm">
      <span className="shrink-0 text-muted-foreground">현재 수집 중</span>
      {job ? (
        <>
          <Link
            href={noticePath(job.input)}
            prefetch={false}
            className="shrink-0 font-medium underline underline-offset-4"
          >
            {job.input.number}-{job.input.revision}
          </Link>
          <span>작업 ID {job.id}</span>
          <span>{job.source === "automatic" ? "자동" : "수동"}</span>
          <span>실패 {job.failures}회</span>
          {job.error && <span className="text-destructive">{job.error}</span>}
        </>
      ) : (
        <span>수집 중인 공고 없음</span>
      )}
    </div>
  );
}

/** 수동·자동 큐의 상태와 현재 작업을 갱신하고 이전 작업을 페이지로 조회한다. */
export function NoticeQueuePage() {
  const path = usePathname();
  const params = useSearchParams();
  const requestedFailed = params.get("tab") === "failed";
  const rawPage = params.get("page");
  const parsed = Number(rawPage);
  const requestedPage =
    /^[1-9]\d*$/.test(rawPage ?? "") && Number.isSafeInteger(parsed)
      ? parsed
      : 1;
  const queryClient = useQueryClient();
  const summary = useQuery<NoticeQueueSummary>({
    queryKey: summaryKey,
    queryFn: ({ signal }) => readQueue("view=summary", signal),
    refetchInterval: (query) => (query.state.data?.currentJob ? 5_000 : 30_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  });
  const queue = summary.data;
  const hasFailures = (queue?.counts.failed ?? 0) > 0;
  const kind: NoticeQueueListKind = requestedFailed && hasFailures ? "failed" : "all";
  const fallbackToAll = requestedFailed && queue !== undefined && !hasFailures;
  const page = fallbackToAll ? 1 : requestedPage;
  // 실패 탭 링크로 들어오면 요약으로 실패 여부를 확인한 뒤 선택된 목록만 요청한다.
  const enabled = !requestedFailed || queue !== undefined;
  const table = useQuery<NoticeQueuePageData>({
    queryKey: [endpoint, "page", kind, page],
    enabled,
    queryFn: ({ signal }) => readQueue(`page=${page}&kind=${kind}`, signal),
    refetchInterval: page === 1 ? (queue?.currentJob ? 5_000 : 30_000) : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: page === 1 ? "always" : false,
    refetchOnReconnect: page === 1,
  });
  const { refetch } = table;
  const totalPages =
    queue && summary.dataUpdatedAt >= table.dataUpdatedAt
      ? kind === "failed" ? queue.failedTotalPages : queue.totalPages
      : table.data?.totalPages;
  const currentId = queue?.currentJob?.id ?? null;
  const lastCurrentId = useRef<number | null>(null);

  useEffect(() => {
    // 현재 작업이 끝나면 첫 페이지에 즉시 반영하고 이후 페이지는 사용자가 조회할 때 갱신한다.
    if (
      enabled && page === 1 &&
      lastCurrentId.current !== null &&
      currentId !== lastCurrentId.current &&
      !document.hidden
    ) {
      void refetch({ cancelRefetch: false });
    }
    lastCurrentId.current = currentId;
  }, [currentId, enabled, page, refetch]);

  useEffect(() => {
    if (!fallbackToAll && !table.data) return;
    const canonicalPage = fallbackToAll ? 1 : Math.min(table.data.page, totalPages ?? table.data.totalPages);
    const canonical = canonicalPage > 1 ? String(canonicalPage) : null;
    if (!fallbackToAll && rawPage === canonical) return;
    const url = new URL(window.location.href);
    if (fallbackToAll) url.searchParams.delete("tab");
    if (canonical) url.searchParams.set("page", canonical);
    else url.searchParams.delete("page");
    window.history.replaceState(null, "", url);
  }, [fallbackToAll, rawPage, table.data, totalPages]);

  const updateManual = useMutation({
    mutationFn: async (manual: boolean) => {
      const response = await businessFetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual }),
      });
      if (!response.ok)
        throw new Error("수동 중단 상태를 변경하지 못했습니다.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: summaryKey }),
  });

  function hrefForPage(destination: number) {
    const query = new URLSearchParams(params);
    if (destination === 1) query.delete("page");
    else query.set("page", String(destination));
    return query.size ? `${path}?${query}` : path;
  }

  function selectTab(value: string) {
    const query = new URLSearchParams(params);
    if (value === "failed") query.set("tab", "failed");
    else query.delete("tab");
    query.delete("page");
    const url = query.size ? `${path}?${query}` : path;
    if (url !== window.location.pathname + window.location.search) window.history.pushState(null, "", url);
  }

  // 요약이 테이블보다 먼저 최신 작업을 확인한 경우에도 현재 작업이 두 곳에 동시에 표시되지 않게 한다.
  const jobs = table.data?.jobs.filter((job) => job.id !== currentId) ?? [];
  return (
    <section className="min-w-0 space-y-5">
      <h1 className="text-2xl font-semibold">공고 수집 큐</h1>
      {summary.isError && <p role="alert">{summary.error.message}</p>}
      {updateManual.isError && <p role="alert">{updateManual.error.message}</p>}
      {queue && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <p>
                {queue.manual || queue.maintenance ? "일시정지" : "실행 가능"}
              </p>
              {queue.manual && (
                <p>
                  {queue.currentJob ? "수동 중단 요청됨" : "수동 중단 적용됨"}
                </p>
              )}
              {!!queue.maintenance && <p>나라장터 점검</p>}
            </div>
            <Button
              className="w-full sm:ml-auto sm:w-auto"
              disabled={updateManual.isPending}
              onClick={() => updateManual.mutate(!queue.manual)}
            >
              {queue.manual ? "수동 중단 해제" : "수동 중단"}
            </Button>
          </div>
          <NoticeCollectionCounts counts={queue.counts} onFailedClick={() => selectTab("failed")} />
          <CurrentQueueJob job={queue.currentJob} />
        </>
      )}
      <Tabs.Root value={kind} onValueChange={selectTab} activationMode="manual">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Tabs.List aria-label="공고 수집 큐 목록" className="flex flex-wrap items-center gap-1">
            <Tabs.Trigger value="all" className={tabClass}>전체 목록</Tabs.Trigger>
            {hasFailures && <Tabs.Trigger value="failed" className={tabClass}>실패 목록</Tabs.Trigger>}
          </Tabs.List>
          <Button type="button" variant="outline" size="sm" className="ml-auto"
            disabled={!enabled || table.isFetching} onClick={() => void refetch()}>
            목록 새로고침
          </Button>
        </div>
        <Tabs.Content value={kind}>
          <ListView
            pagination={
              table.data && {
                page: table.data.page,
                totalPages: totalPages ?? table.data.totalPages,
                hrefForPage,
                shallow: true,
              }
            }
          >
            <div className="space-y-2">
              {table.isError && <p role="alert">{table.error.message}</p>}
              {table.isPending && (
                <p role="status">공고 목록을 불러오는 중입니다.</p>
              )}
              {table.data &&
                (jobs.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-225 table-fixed text-left text-sm">
                      <colgroup>
                        <col className="w-[10%]" />
                        <col className="w-[22%]" />
                        <col className="w-[12%]" />
                        <col className="w-[12%]" />
                        <col className="w-[12%]" />
                        <col className="w-[32%]" />
                      </colgroup>
                      <caption className="sr-only">공고 수집 작업</caption>
                      <thead>
                        <tr className="border-b">
                          <th className="p-2">작업 ID</th>
                          <th>공고번호·차수</th>
                          <th>수집 방식</th>
                          <th>상태</th>
                          <th>실패 횟수</th>
                          <th>오류</th>
                        </tr>
                      </thead>
                      <tbody>
                        {jobs.map((job) => {
                          const href = noticePath(job.input);

                          return (
                            <tr
                              key={job.id}
                              className={cn(
                                "group relative border-b",
                                "hover:bg-muted/50",
                                job.status === "failed" &&
                                  "bg-red-50 text-red-800 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50",
                                job.status === "retry_wait" &&
                                  "bg-yellow-50 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-950/30 dark:text-yellow-300 dark:hover:bg-yellow-950/50",
                              )}
                            >
                              <td className="p-2">
                                <Link
                                  href={href}
                                  prefetch={false}
                                  className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                  aria-label={`${job.input.number}-${job.input.revision} 공고 상세 보기`}
                                />
                                {job.id}
                              </td>
                              <td>
                                {job.input.number}-{job.input.revision}
                              </td>
                              <td>
                                {job.source === "automatic" ? "자동" : "수동"}
                              </td>
                              <td>{labels[job.status]}</td>
                              <td>{job.failures}</td>
                              <td>{job.error}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="py-3">{kind === "failed" ? "최종 실패한 공고가 없습니다." : "표시할 작업이 없습니다."}</p>
                ))}
            </div>
          </ListView>
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
