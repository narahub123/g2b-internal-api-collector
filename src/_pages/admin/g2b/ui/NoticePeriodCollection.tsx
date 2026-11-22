"use client";

import { businessFetch } from "@/features/service-auth/business-client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { NoticeRunSummary, NoticeRunPeriod } from "@/server/g2b/repository/notice-queue-types";
import { collectionCountFormat } from "./collection-count-labels";

import { NoticeCollectionList } from "./NoticeCollectionList";
import { NoticeCollectionPanel } from "./NoticeCollectionPanel";

const endpoint = "/api/g2b/notice-collection-runs";
const runLabels: Record<NoticeRunSummary["status"], string> = {
  pending: "수집 대기",
  discovering: "공고 목록 확인 중",
  collecting: "공고 상세 수집 중",
  completed: "수집 종료",
  failed: "공고 목록 조회 실패",
};

/** 기간 수집을 접수하고 완료될 때까지 실행별 집계와 공고 상태를 갱신한다. */
export function NoticePeriodCollection() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<NoticeRunPeriod>({ startMinute: "", endMinute: "" });
  const [run, setRun] = useState<NoticeRunSummary | null>(null);
  const [id, setId] = useState<number>();
  const restoredId = useRef<number | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [inputError, setInputError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [refreshError, setRefreshError] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const submission = useRef<{ body: string; key: string } | null>(null);
  const requestController = useRef<AbortController>(null);
  useEffect(() => () => requestController.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let fetching = false;
    let activeId = id ?? restoredId.current;
    function schedule() {
      if (!document.hidden) timer = setTimeout(refresh, 2000);
    }
    async function refresh() {
      if (document.hidden || fetching || controller.signal.aborted) return;
      fetching = true;
      try {
        const path = activeId === undefined ? endpoint : `${endpoint}/${activeId}`;
        const response = await businessFetch(`${path}?view=summary`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) throw new Error("수집 상태 조회 실패");
        const current: NoticeRunSummary | null = await response.json();
        if (controller.signal.aborted) return;
        setRun(current);
        setRefreshError(false);
        if (activeId === undefined && current) {
          activeId = current.id;
          restoredId.current = current.id;
          setPeriod((previous) => previous.startMinute || previous.endMinute ? previous : {
            startMinute: current.startMinute, endMinute: current.endMinute,
          });
        }
        if (current && current.status !== "completed" && current.status !== "failed") {
          schedule();
        }
      } catch {
        if (controller.signal.aborted) return;
        // 마지막 성공 응답은 화면에 유지하고 다음 조회에서 복구한다.
        setRefreshError(true);
        schedule();
      } finally {
        fetching = false;
        if (!controller.signal.aborted) setRestoring(false);
      }
    }
    function refreshOnVisibility() {
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    }
    document.addEventListener("visibilitychange", refreshOnVisibility);
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, [id, open, refreshVersion]);

  async function start(nextPeriod: NoticeRunPeriod) {
    if (requestController.current) return;
    setInputError("");
    setSubmitError("");
    if (!nextPeriod.startMinute || !nextPeriod.endMinute || nextPeriod.startMinute > nextPeriod.endMinute) {
      setInputError("시작·종료 시각을 입력하고 순서를 확인해 주세요.");
      return;
    }

    const body = JSON.stringify(nextPeriod);
    // 접수 응답이 유실되어 같은 기간을 다시 보내면 기존 실행을 돌려받는다.
    if (submission.current?.body !== body) submission.current = { body, key: crypto.randomUUID() };
    const controller = new AbortController();
    requestController.current = controller;
    setSubmitting(true);
    try {
      const response = await businessFetch(endpoint, {
        method: "POST", body,
        headers: { "Content-Type": "application/json", "Idempotency-Key": submission.current.key },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      });
      const data = await response.json();
      if (response.status === 400) {
        setInputError(data.error);
        return;
      }
      if (response.status !== 202 || !Number.isSafeInteger(data.id)) {
        setSubmitError(data.error || "기간 수집을 접수하지 못했습니다.");
        return;
      }
      submission.current = null;
      setRun((previous) => previous?.id === data.id ? previous : null);
      setId(data.id);
      setRefreshVersion((version) => version + 1);
    } catch {
      if (!controller.signal.aborted) setSubmitError("접수 응답을 확인하지 못했습니다. 최근 실행을 확인하거나 같은 기간으로 다시 시도해 주세요.");
    } finally {
      requestController.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void start(period);
  }

  // 집계는 현재 총 대상을 먼저 보여 주고 최초 예정 건수를 뒤에 배치한다.
  const counts = run && [
    ["현재 총 대상", run.totalCount], ["최초 예정", run.initialCount],
    ["수집 완료", run.succeededCount], ["수집 실패", run.failedCount],
  ] as const;

  return (
    <NoticeCollectionPanel title="입찰공고 기간 수집" open={open} onOpenChange={setOpen}>
      <div className="space-y-4">
        <form onSubmit={submit} className="space-y-2" noValidate>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5 text-sm">
              시작 시각 (한국 시간)
              <Input type="datetime-local" step={60} required value={period.startMinute}
                aria-invalid={Boolean(inputError)} aria-describedby={inputError ? "notice-period-error" : undefined}
                onChange={(event) => setPeriod({ ...period, startMinute: event.target.value })} />
            </label>
            <label className="grid gap-1.5 text-sm">
              종료 시각 (한국 시간)
              <Input type="datetime-local" step={60} required value={period.endMinute}
                aria-invalid={Boolean(inputError)} aria-describedby={inputError ? "notice-period-error" : undefined}
                onChange={(event) => setPeriod({ ...period, endMinute: event.target.value })} />
            </label>
            <Button type="submit" disabled={submitting || restoring}>{submitting ? "접수 중…" : "수집 시작"}</Button>
          </div>
          {inputError && <p id="notice-period-error" role="alert" className="text-sm text-destructive">{inputError}</p>}
        </form>
        {submitError && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">{submitError}</p>
            <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={() => {
              restoredId.current = undefined;
              setId(undefined);
              setRefreshVersion((version) => version + 1);
            }}>최근 실행 확인</Button>
          </div>
        )}
        {refreshError && <p role="status" className="text-sm text-destructive">수집 상태를 갱신하지 못했습니다. 다시 확인 중입니다.</p>}
        {run && (
          <div className="space-y-3">
            <p role="status" className="text-sm">
              {run.startMinute.replace("T", " ")} ~ {run.endMinute.replace("T", " ")} · {
                run.pauseReason === "maintenance" ? "나라장터 점검 대기" :
                  run.pauseReason === "manual" ? "수집 일시 중단" : runLabels[run.status]
              }
            </p>
            {run.error && <p className="text-sm text-destructive">{run.error}</p>}
            {run.status === "failed" && (
              <Button type="button" variant="outline" size="sm" disabled={submitting}
                onClick={() => void start({ startMinute: run.startMinute, endMinute: run.endMinute })}>같은 기간으로 다시 시작</Button>
            )}
            {run.initialCount !== null && counts && (
              <>
                <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-4">
                  {counts.map(([label, count]) => (
                    <div key={label}>
                      <dt className="text-sm text-muted-foreground">{label}</dt>
                      {/* 실패 건수만 오류 색상을 사용하고 다른 집계의 색상은 유지한다. */}
                      <dd className={`font-semibold tabular-nums${label === "수집 실패" ? " text-destructive" : ""}`}>{collectionCountFormat.format(count ?? 0)}건</dd>
                    </div>
                  ))}
                </dl>
                {(["all", "failed"] as const).map((kind) => (
                  <NoticeCollectionList key={kind} scope="period" kind={kind} panelOpen={open}
                    roundId={run.id} failedCount={run.failedCount}
                    pollInterval={run.status === "completed" || run.status === "failed" ? false : 5_000} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </NoticeCollectionPanel>
  );
}
