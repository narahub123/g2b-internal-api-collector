"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type {
  NoticeAutomaticCursor, NoticeAutomaticListKind, NoticeAutomaticPage,
} from "@/features/collect-g2b/model/notice-automatic";
import type { NoticeRunNoticePage } from "@/server/g2b/repository/notice-queue-types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/shared/ui/accordion";
import { Button } from "@/shared/ui/button";
import { ListView } from "@/shared/ui/list-controls/ListView";
import { NoticeRunNoticeRow } from "./NoticeRunNoticeRow";
import { collectionCountFormat } from "./collection-count-labels";

const labels = { all: "수집 공고 목록", failed: "수집 실패 목록" };
const cursorKeys = {
  automatic: { all: "automaticNotices", failed: "automaticFailures" },
  period: { all: "periodNotices", failed: "periodFailures" },
};

/** 열린 목록에만 네트워크 조회를 붙이고, 첫 페이지에서 자동 수집 상태를 갱신한다. */
export function NoticeCollectionList({ kind, scope, roundId, panelOpen, pollInterval, failedCount }: {
  kind: NoticeAutomaticListKind;
  scope: keyof typeof cursorKeys;
  roundId?: number;
  panelOpen: boolean;
  pollInterval: number | false;
  failedCount: number;
}) {
  const path = usePathname();
  const params = useSearchParams();
  const key = cursorKeys[scope][kind];
  const rawCursor = params.get(key);
  const cursor = rawCursor?.startsWith(`${roundId}.`) ? rawCursor : null;
  const [open, setOpen] = useState(Boolean(rawCursor));
  const visible = kind === "all" || failedCount > 0;
  const enabled = panelOpen && open && visible;
  const stopped = pollInterval === false;
  const wasStopped = useRef(stopped);
  const list = useQuery<NoticeAutomaticPage>({
    queryKey: ["notice-collection-list", scope, kind, roundId, cursor],
    enabled,
    refetchInterval: enabled && !cursor ? pollInterval : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: enabled && !cursor && !stopped ? "always" : false,
    refetchOnReconnect: enabled && !cursor && !stopped,
    queryFn: async ({ signal }) => {
      const query = new URLSearchParams({ kind });
      if (cursor) query.set("cursor", scope === "period" ? cursor.slice(cursor.indexOf(".") + 1) : cursor);
      const endpoint = scope === "period"
        ? `/api/g2b/notice-collection-runs/${roundId}` : "/api/g2b/notice-queue/automatic/notices";
      const response = await fetch(`${endpoint}?${query}`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("수집 공고 목록을 불러오지 못했습니다.");
      if (scope === "automatic") return response.json();
      const page: NoticeRunNoticePage = await response.json();
      const toCursor = (boundary: NoticeRunNoticePage["next"]) => boundary && ({
        walkId: roundId!, direction: boundary.direction, jobId: boundary.visitId,
      });
      return { ...page, round: null, previous: toCursor(page.previous), next: toCursor(page.next) };
    },
  });

  const { refetch } = list;
  useEffect(() => {
    // 중단이 적용되어 폴링이 멈추기 전에 마지막 실행의 결과를 한 번 반영한다.
    if (enabled && !cursor && stopped && !wasStopped.current && !document.hidden) {
      void refetch({ cancelRefetch: false });
    }
    wasStopped.current = stopped;
  }, [cursor, enabled, refetch, stopped]);

  useEffect(() => {
    if (!visible) setOpen(false);
    if (!rawCursor || (visible && cursor && !list.data?.resetCursor)) return;
    // 다른 목록이나 대시보드 조건은 유지하면서 이전 회차의 이동 위치만 지운다.
    const url = new URL(window.location.href);
    url.searchParams.delete(key);
    window.history.replaceState(null, "", url);
  }, [cursor, key, list.data?.resetCursor, rawCursor, visible]);

  function href(boundary: NoticeAutomaticCursor | null | undefined) {
    if (!boundary) return undefined;
    const query = new URLSearchParams(params);
    query.set(key, `${boundary.walkId}.${boundary.direction}.${boundary.jobId}`);
    return `${path}?${query}`;
  }

  if (!visible) return null;
  return (
    <Accordion type="single" collapsible value={open ? kind : ""} onValueChange={(value) => setOpen(Boolean(value))}>
      <AccordionItem value={kind}>
        <AccordionTrigger className="cursor-pointer hover:no-underline">
          <span>{labels[kind]}{kind === "failed" && (
            <span className="ml-2 text-destructive">({collectionCountFormat.format(failedCount)}건)</span>
          )}</span>
        </AccordionTrigger>
        <AccordionContent>
          {open && (
            <ListView pagination={{ mode: "cursor", previousHref: href(list.data?.previous), nextHref: href(list.data?.next) }}>
              <div className="space-y-2">
                <Button type="button" size="sm" variant="outline" disabled={list.isFetching}
                  onClick={() => void list.refetch()}>목록 새로고침</Button>
                {list.isError && <p role="alert" className="text-destructive">{list.error.message}</p>}
                {list.isPending && <p role="status">공고 목록을 불러오는 중입니다.</p>}
                {list.data?.round && list.data.round.walkId !== roundId && (
                  <p className="text-muted-foreground">
                    기준 회차 {list.data.round.startMinute.replace("T", " ")} ~ {list.data.round.endMinute.replace("T", " ")}
                  </p>
                )}
                {list.data && (list.data.items.length ? (
                  <ul className="divide-y">
                    {list.data.items.map((notice) => <NoticeRunNoticeRow key={notice.id} notice={notice} />)}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    {kind === "failed" ? "최종 실패한 공고가 없습니다." : "수집 대상 공고가 없습니다."}
                  </p>
                ))}
              </div>
            </ListView>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
