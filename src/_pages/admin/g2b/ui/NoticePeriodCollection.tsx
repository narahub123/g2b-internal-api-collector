"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { noticePath } from "@/_pages/admin/config/routes";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/shared/ui/accordion";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { NoticeRun, NoticeRunPeriod } from "@/server/g2b/repository/notice-queue-types";
import { collectionCountFormat } from "./collection-count-labels";
import { noticeRunJobLabels } from "./notice-run-status";

const endpoint = "/api/g2b/notice-collection-runs";
const runLabels: Record<NoticeRun["status"], string> = {
  pending: "수집 대기",
  discovering: "공고 목록 확인 중",
  collecting: "공고 상세 수집 중",
  completed: "수집 종료",
  failed: "공고 목록 조회 실패",
};

/** 기간 수집을 접수하고 완료될 때까지 실행별 집계와 공고 상태를 갱신한다. */
export function NoticePeriodCollection() {
  const [period, setPeriod] = useState<NoticeRunPeriod>({ startMinute: "", endMinute: "" });
  const [run, setRun] = useState<NoticeRun | null>(null);
  const [id, setId] = useState<number>();
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
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(id === undefined ? endpoint : `${endpoint}/${id}`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) throw new Error("수집 상태 조회 실패");
        const current: NoticeRun | null = await response.json();
        if (controller.signal.aborted) return;
        setRun(current);
        setRefreshError(false);
        if (id === undefined && current) {
          setId(current.id);
          setPeriod((previous) => previous.startMinute || previous.endMinute ? previous : {
            startMinute: current.startMinute, endMinute: current.endMinute,
          });
        } else if (current && current.status !== "completed" && current.status !== "failed") {
          timer = setTimeout(refresh, 2000);
        }
      } catch {
        if (controller.signal.aborted) return;
        // 마지막 성공 응답은 화면에 유지하고 다음 조회에서 복구한다.
        setRefreshError(true);
        timer = setTimeout(refresh, 2000);
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, refreshVersion]);

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
      const response = await fetch(endpoint, {
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

  const counts = run && [
    ["최초 예정", run.initialCount], ["현재 총 대상", run.totalCount],
    ["수집 완료", run.succeededCount], ["수집 실패", run.failedCount],
  ] as const;

  return (
    <section aria-labelledby="notice-period-heading" className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
      <h2 id="notice-period-heading" className="text-lg font-semibold">입찰공고 기간 수집</h2>
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
                    <dd className="font-semibold tabular-nums">{collectionCountFormat.format(count ?? 0)}건</dd>
                  </div>
                ))}
              </dl>
              <Accordion type="single" collapsible>
                <AccordionItem value="notices">
                  <AccordionTrigger>수집 공고 목록</AccordionTrigger>
                  <AccordionContent>
                    {run.notices.length === 0 ? <p className="text-muted-foreground">수집 대상 공고가 없습니다.</p> : (
                      <ul className="divide-y">
                        {run.notices.map((notice) => (
                          <li key={noticePath(notice)}>
                            <Link href={noticePath(notice)} prefetch={false}
                              className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-sm px-2 py-2 hover:bg-muted focus-visible:outline-ring sm:gap-4">
                              <span className="truncate" title={notice.title}>{notice.title || "공고명 미확인"}</span>
                              <span className="tabular-nums">{notice.number}</span>
                              <span aria-label={`차수 ${notice.revision}`}>{notice.revision}</span>
                              <span className={notice.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                                {noticeRunJobLabels[notice.status]}
                              </span>
                            </Link>
                            {notice.status === "failed" && notice.error && (
                              <p className="break-all px-2 pb-2 text-xs text-destructive">{notice.error}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </>
          )}
        </div>
      )}
    </section>
  );
}
