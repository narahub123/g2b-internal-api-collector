"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { businessFetch } from "@/features/service-auth/business-client";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader } from "@/shared/ui/card";
import { collectDictionaries, saveDictionarySchedule } from "./collect-dictionaries";
import type { getDictionaryCards } from "./dictionary-server";
import type { DictionaryId } from "./dictionaries";
import type { DictionaryJobStatus, DictionaryOutcome, DictionarySchedule } from "@/server/collections/dictionary-queue";
import { DictionaryScheduleForm } from "./DictionaryScheduleForm";

/** 수집 화면이 받을 서버 집계 및 조회 상태다. */
type Cards = Awaited<ReturnType<typeof getDictionaryCards>>;
/** 버튼이 실행할 사전 또는 전체 사전이다. */
type Target = DictionaryId | "all";

// 서버와 브라우저에서 실행 시각을 한국 시간으로 동일하게 표시한다.
const scheduleTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short",
});

// 코드별 실행 결과를 사용자가 확인할 문구로 연결한다.
const labels: Record<DictionaryJobStatus | DictionaryOutcome, string> = {
  created: "최초 저장", updated: "갱신", unchanged: "변경 없음", failed: "수집 실패",
  pending: "대기", running: "수집 진행 중", retry_wait: "재시도 대기", succeeded: "완료", cancelled: "취소",
};

/** 관리자 상태 API가 제공하는 작업과 완료 카드다. */
type QueueStatus = {
  /** 추적 중인 작업 목록. */
  jobs: { id: number; key: DictionaryId; status: DictionaryJobStatus; result: DictionaryOutcome | null }[];
  /** 유효한 작업이 실행을 기다리거나 처리 중인지 여부. */
  pending: boolean;
  /** 원격 수집 성공 후 새로 조회한 카드. */
  cards?: Cards;
};

/**
 * 접수한 작업의 상태만 관리자 API에서 읽는다.
 * @param ids 화면이 추적하는 작업 ID.
 * @param signal 화면 이동이나 요청 변경 시 폴링을 중단하는 신호.
 * @returns 작업 상태와 완료 시 카드 정보.
 */
async function getQueueStatus(ids: number[], signal: AbortSignal): Promise<QueueStatus> {
  const params = new URLSearchParams(ids.map((id) => ["id", String(id)]));
  const response = await businessFetch(`/api/dictionaries/queue/status?${params}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("수집 상태를 조회하지 못했습니다.");
  return response.json();
}

/**
 * 전체 및 개별 수집 상태와 카드 정보를 한 화면에서 관리한다.
 * @param props.cards 서버에서 읽은 카드별 메타데이터.
 * @param props.settings 각 사전의 영속 실행 설정.
 * @returns 수집 버튼, 결과 안내 및 상세 링크.
 */
export function DictionaryManagement({ cards, settings }: { cards: Cards; settings: DictionarySchedule[] }) {
  // 수집이 끝나면 페이지의 서버 설정을 다시 읽는다.
  const router = useRouter();
  // 빠른 연속 입력도 같은 실행 지점에서 막고 실행 대상을 아이콘에 반영한다.
  const running = useRef(false);
  const [target, setTarget] = useState<Target>();
  const [result, setResult] = useState<Awaited<ReturnType<typeof collectDictionaries>>>();
  const [pending, startTransition] = useTransition();
  // 아직 실행되지 않았거나 진행 중인 작업에 대해서만 DB 상태를 반복 조회한다.
  const ids = result?.ids ?? [];
  const queue = useQuery({
    queryKey: ["dictionary-jobs", ...ids],
    queryFn: ({ signal }) => getQueueStatus(ids, signal),
    enabled: ids.length > 0,
    refetchInterval: (query) => query.state.data?.pending === false ? false : 2_000,
    refetchOnWindowFocus: false,
  });
  const tracking = ids.length > 0 && queue.data?.pending !== false;
  const displayedCards = queue.data?.cards ?? cards;
  // 전체 수집의 부분 실패를 포함해 접수한 작업이 모두 종결된 시점에 일정을 읽는다.
  const finished = ids.length > 0 && queue.data?.pending === false;

  /**
   * 작업 완료 전환에서만 서버 페이지를 갱신하고 폼 입력 상태는 보존한다.
   */
  function refreshSchedule() {
    if (finished) router.refresh();
  }
  useEffect(refreshSchedule, [finished, router]);

  /**
   * 권한 검증이 포함된 서버 액션을 실행하고 성공 및 실패 결과를 반영한다.
   * @param selected 수집할 사전 또는 전체.
   */
  function collect(selected: Target) {
    if (running.current || (tracking && (!result?.warning || target !== selected))) return;
    running.current = true;
    setTarget(selected);
    setResult(undefined);
    startTransition(async () => {
      try {
        setResult(await collectDictionaries(selected));
      } catch {
        setResult({ error: "수집 요청을 완료하지 못했습니다. 다시 시도해 주세요.", ids: [] });
      } finally {
        // 성공과 실패 모두에서 다시 실행할 수 있게 상태를 정리한다.
        running.current = false;
      }
    });
  }

  /**
   * 제목의 오른쪽에 놓일 아이콘 버튼을 만든다.
   * @param selected 버튼이 실행할 사전 식별자.
   * @param label 접근성 이름과 마우스 안내에 사용할 문구.
   * @returns 실행 중 상태를 반영한 수집 버튼.
   */
  function collectButton(selected: Target, label: string) {
    // 진행 상태를 아이콘과 접근성 속성에서 함께 전달한다.
    const active = target === selected && (pending || tracking);
    const Icon = active ? LoaderCircle : Download;
    return (
      <Button type="button" variant="outline" size="icon" title={label} aria-label={label}
        aria-busy={active} disabled={pending || (tracking && (!result?.warning || target !== selected))} onClick={() => collect(selected)}>
        <Icon aria-hidden="true" className={active ? "animate-spin" : undefined} />
      </Button>
    );
  }

  return (
    <section className="space-y-6">
      {/* 화면 제목과 전체 실행 버튼을 양쪽 끝에 배치한다. */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">사전 목록 관리</h1>
        {collectButton("all", "전체 수집")}
      </div>
      {/* 액션 상태와 인증 실패를 보조기술에도 전달한다. */}
      <div aria-live="polite" className="empty:hidden">
        {(pending || tracking) && <p>사전 수집 상태를 확인하고 있습니다.</p>}
        {result?.error && <p className="text-destructive">{result.error}</p>}
        {tracking && result?.warning && <p>{result.warning} 수집 버튼으로 다시 요청할 수 있습니다.</p>}
        {queue.isError && <p className="text-destructive">수집 상태를 조회하지 못했습니다.</p>}
        {queue.data?.jobs.length > 0 && (
          <ul className="space-y-1 text-sm">
            {queue.data.jobs.map(({ id, key, status, result }) => (
              <li key={id} className={status === "failed" ? "text-destructive" : undefined}>
                {cards.find((card) => card.id === key)?.title} · {labels[result ?? status]}
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* 카드에는 독립된 수집과 상세 이동 동작을 제공한다. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {displayedCards.map(({ id, title, href, details, failed }) => {
          // 사전별 설정은 같은 카드에서만 편집한다.
          const schedule = settings.find(({ key }) => key === id);
          return (
            <Card key={id}>
              <CardHeader>
                <h2 className="self-center text-lg font-semibold">{title}</h2>
                <CardAction>{collectButton(id, `${title} 수집`)}</CardAction>
              </CardHeader>
              <CardContent className="grow space-y-2">
                {failed ? <p className="text-sm text-destructive">수집 정보를 조회하지 못했습니다.</p> : (
                  <>
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">전체 건수</dt>
                        <dd>{(details?.total ?? 0).toLocaleString("ko-KR")}건</dd>
                      </div>
                      {details?.fields.map(({ label, value }) => (
                        <div key={label} className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="text-right">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {!details && <p className="text-sm text-muted-foreground">아직 수집된 자료가 없습니다.</p>}
                  </>
                )}
                {/* Blob 조회 여부와 독립적으로 마지막 확인 성공과 자동 접수 가능 시각을 보여준다. */}
                {schedule && (
                  <>
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">마지막 성공 확인 시각</dt>
                        <dd>{schedule.lastSuccessAt === null ? "—" : scheduleTime.format(schedule.lastSuccessAt)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">다음 확인 시각</dt>
                        <dd>{schedule.nextAt === null ? "—" : scheduleTime.format(schedule.nextAt)}</dd>
                      </div>
                    </dl>
                    {/* 화면에서 사전 식별자와 서버 액션을 연결하고 폼에는 편집값만 전달한다. */}
                    <DictionaryScheduleForm settings={{ enabled: schedule.enabled, days: schedule.days }}
                      onSave={({ enabled, days }) => saveDictionarySchedule(id, enabled, days)} />
                  </>
                )}
              </CardContent>
              <CardFooter>
                <Button asChild variant="outline" size="sm"><Link href={href} prefetch={false}>목록 보기</Link></Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
