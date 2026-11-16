"use client";

import { useEffect, useState } from "react";
import { Button } from "@/shared/ui/button";
import type { NoticeQueue } from "@/server/g2b/repository/notice-queue-types";

const endpoint = "/api/g2b/notice-queue";
const labels = { pending: "대기", running: "실행 중", retry_wait: "재시도 대기", succeeded: "완료", failed: "최종 실패" };

/** 수동·자동 공고 작업의 실행 상태를 확인하고 전체 큐의 일시 중단을 관리한다. */
export function NoticeQueuePage() {
  const [queue, setQueue] = useState<Awaited<ReturnType<NoticeQueue["overview"]>>>();
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        setQueue(await response.json());
        setReadError("");
      } catch {
        if (!controller.signal.aborted) setReadError("공고 큐 상태를 불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 1500);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  async function setManual(manual: boolean) {
    setSaving(true);
    setActionError("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manual }),
      });
      if (!response.ok) throw new Error();
      setQueue((previous) => previous && { ...previous, manual });
    } catch {
      setActionError("수동 중단 상태를 변경하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold">공고 수집 큐</h1>
      {readError && <p role="alert">{readError}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {queue && <>
        <div className="flex flex-wrap items-center gap-3">
          <p>{queue.manual || queue.maintenance ? "일시정지" : "실행 가능"}</p>
          {queue.manual && <p>{queue.active ? "수동 중단 요청됨" : "수동 중단 적용됨"}</p>}
          {!!queue.maintenance && <p>나라장터 점검</p>}
          {queue.active && <p>실행 중인 작업 {queue.active}</p>}
          <Button disabled={saving} onClick={() => void setManual(!queue.manual)}>
            {queue.manual ? "수동 중단 해제" : "수동 중단"}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">최근 공고 수집 작업</caption>
            <thead><tr className="border-b"><th className="p-2">작업 ID</th><th>공고번호·차수</th><th>수집 방식</th><th>상태</th><th>실패 횟수</th><th>오류</th></tr></thead>
            <tbody>{queue.jobs.map((job) => (
              <tr className="border-b" key={job.id}>
                <td className="p-2">{job.id}</td>
                <td>{job.input.number}-{job.input.revision}</td><td>{job.source === "automatic" ? "자동" : "수동"}</td>
                <td>{labels[job.status]}</td>
                <td>{job.failures}</td><td>{job.error}</td>
              </tr>
            ))}</tbody>
          </table>
          {!queue.jobs.length && <p className="py-3">접수된 작업이 없습니다.</p>}
        </div>
      </>}
    </section>
  );
}
