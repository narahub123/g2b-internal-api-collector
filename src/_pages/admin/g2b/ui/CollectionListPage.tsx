import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { RecollectButton } from "@/features/collect-g2b/ui/RecollectButton";
import { getG2bRepository } from "@/server/g2b/repository";
import type {
  CollectionOverview,
  CollectionSection,
} from "@/server/g2b/repository/collection-attempts";
import { G2B_SECTIONS } from "@/shared/config/g2b-sections";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { ADMIN_G2B_PATH, collectionDetailPaths } from "../../config/routes";
import { CollectionForm } from "./CollectionForm";
import {
  collectionCountFormat,
  collectionCountLabels,
} from "./collection-count-labels";
import { CollectionListItem } from "./CollectionListItem";
import { CollectionListLabel } from "./CollectionListLabel";

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

const failureLabels = {
  failed: "실패",
  deferred: "점검 보류",
  pending: "결과 미확인",
} as const;

type TargetKey = Pick<
  CollectionOverview["saved"][number],
  "number" | "revision" | "openingRevision"
>;

function targetKey({ number, revision, openingRevision }: TargetKey) {
  return JSON.stringify([number, revision, openingRevision]);
}

function targetLabel({ number, revision, openingRevision }: TargetKey) {
  return [number, revision, openingRevision && `개찰 ${openingRevision}차`]
    .filter(Boolean)
    .join("/");
}

/**
 * URL에서 선택된 필터에 맞춰 저장 자료와 최신 실패 상태를 대상별 한 행으로 표시한다.
 * @param props.searchParams status에 collected 또는 uncollected를 지정하면 해당 목록을 연다.
 * @throws SQLite에서 업무 목록과 수집 이력을 읽지 못한 경우.
 */
export async function CollectionListPage({
  section,
  searchParams,
}: {
  section: CollectionSection;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { status } = await searchParams;
  const selected =
    status === "collected" || status === "uncollected" ? status : "total";
  const repository = getG2bRepository();
  const { counts, saved, failures } =
    repository.collectionAttempts.overview(section);
  const failureByKey = new Map(
    failures.map((failure) => [targetKey(failure), failure]),
  );

  // 저장 자료가 있는 재수집 실패는 기존 항목에 표시해 목록과 집계에서 중복되지 않게 한다.
  const savedRows =
    selected === "uncollected"
      ? []
      : saved.map((item) => ({
          item,
          savedItem: item,
          failure: failureByKey.get(targetKey(item)),
        }));
  const missingRows =
    selected === "collected"
      ? []
      : failures
          .filter(({ hasData }) => !hasData)
          .map((failure) => ({
            item: failure,
            savedItem: undefined,
            failure,
          }));
  const rows = [...savedRows, ...missingRows];
  const href = `${ADMIN_G2B_PATH}/${section}`;

  return (
    <section className="grid min-w-0 gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{G2B_SECTIONS[section]}</h1>
        <Button asChild variant="outline">
          <Link href={ADMIN_G2B_PATH}>
            <ArrowLeft aria-hidden="true" />
            나라장터로 돌아가기
          </Link>
        </Button>
      </header>
      <CollectionForm section={section} />
      <nav
        aria-label="수집 상태로 필터링"
        className="grid grid-cols-3 overflow-hidden rounded-xl border bg-card"
      >
        {collectionCountLabels.map(([key, label]) => (
          <Link
            key={key}
            href={key === "total" ? href : `${href}?status=${key}`}
            aria-current={selected === key ? "page" : undefined}
            className={cn(
              "flex min-w-0 flex-wrap items-center justify-between gap-x-2 border-b-2 border-transparent px-3 py-4 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5",
              selected === key && "border-primary bg-muted",
              key === "uncollected" && "text-destructive",
            )}
          >
            <span
              className={cn(
                "text-sm",
                key !== "uncollected" && "text-muted-foreground",
              )}
            >
              {label}
            </span>
            <span className="wrap-anywhere text-base font-semibold tabular-nums">
              {collectionCountFormat.format(counts[key])}건
            </span>
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          해당하는 자료가 없습니다.
        </p>
      ) : (
        <ul className="grid gap-2">
          {rows.map(({ item, savedItem, failure }) => {
            const key = targetKey(item);
            return (
              <CollectionListItem
                key={key}
                href={savedItem ? collectionDetailPaths[section](item) : undefined}
                action={
                  failure && (
                    <RecollectButton
                      endpoint={`/api/g2b/collection-attempts/${failure.id}/retry`}
                      refreshOnError
                    />
                  )
                }
                status={
                  failure && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        <time dateTime={failure.startedAt}>
                          {dateFormat.format(new Date(failure.startedAt))}
                        </time>
                        {" · "}
                        {failureLabels[failure.status]}
                      </p>
                      {failure.error && (
                        <p className="wrap-anywhere text-destructive">
                          {failure.error}
                        </p>
                      )}
                    </>
                  )
                }
              >
                <CollectionListLabel
                  identifier={targetLabel(item)}
                  title={savedItem?.title}
                  businessCode={savedItem?.businessCode}
                  businessLabel={savedItem?.businessLabel}
                />
              </CollectionListItem>
            );
          })}
        </ul>
      )}
    </section>
  );
}
