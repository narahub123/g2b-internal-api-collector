"use client";

import Link from "next/link";
import { Download, LoaderCircle } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader } from "@/shared/ui/card";
import { collectDictionaries } from "./collect-dictionaries";
import type { getDictionaryCards } from "./dictionary-server";
import type { DictionaryCollectionResult, DictionaryId } from "./dictionaries";

/** 수집 화면이 받을 서버 집계 및 조회 상태다. */
type Cards = Awaited<ReturnType<typeof getDictionaryCards>>;
/** 버튼이 실행할 사전 또는 전체 사전이다. */
type Target = DictionaryId | "all";

// 코드별 실행 결과를 사용자가 확인할 문구로 연결한다.
const labels: Record<DictionaryCollectionResult["status"], string> = {
  created: "최초 저장", updated: "갱신", unchanged: "변경 없음", busy: "수집 진행 중", failed: "수집 실패",
};

/**
 * 전체 및 개별 수집 상태와 카드 정보를 한 화면에서 관리한다.
 * @param props.cards 서버에서 읽은 카드별 메타데이터.
 * @returns 수집 버튼, 결과 안내 및 상세 링크.
 */
export function DictionaryManagement({ cards }: { cards: Cards }) {
  // 빠른 연속 입력도 같은 실행 지점에서 막고 실행 대상을 아이콘에 반영한다.
  const running = useRef(false);
  const [target, setTarget] = useState<Target>();
  const [result, setResult] = useState<Awaited<ReturnType<typeof collectDictionaries>>>();
  const [pending, startTransition] = useTransition();

  /**
   * 권한 검증이 포함된 서버 액션을 실행하고 성공 및 실패 결과를 반영한다.
   * @param selected 수집할 사전 또는 전체.
   */
  function collect(selected: Target) {
    if (running.current) return;
    running.current = true;
    setTarget(selected);
    setResult(undefined);
    startTransition(async () => {
      try {
        setResult(await collectDictionaries(selected));
      } catch {
        setResult({ error: "수집 요청을 완료하지 못했습니다. 다시 시도해 주세요.", results: [] });
      } finally {
        // 성공과 실패 모두에서 다시 실행할 수 있게 상태를 정리한다.
        running.current = false;
        setTarget(undefined);
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
    const active = target === selected;
    const Icon = active ? LoaderCircle : Download;
    return (
      <Button type="button" variant="outline" size="icon" title={label} aria-label={label}
        aria-busy={active} disabled={pending || target !== undefined} onClick={() => collect(selected)}>
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
        {target && <p>사전을 수집하고 있습니다.</p>}
        {result?.error && <p className="text-destructive">{result.error}</p>}
        {result?.results.length > 0 && (
          <ul className="space-y-1 text-sm">
            {result.results.map(({ id, status }) => (
              <li key={id} className={status === "failed" ? "text-destructive" : undefined}>
                {cards.find((card) => card.id === id)?.title} · {labels[status]}
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* 카드에는 독립된 수집과 상세 이동 동작을 제공한다. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map(({ id, title, href, details, failed }) => (
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
            </CardContent>
            <CardFooter>
              <Button asChild variant="outline" size="sm"><Link href={href} prefetch={false}>목록 보기</Link></Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}
