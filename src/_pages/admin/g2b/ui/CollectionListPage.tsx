import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { formatCollectionIdentifier } from "@/shared/model/g2b/collection-list-query";
import type { CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";
import { RecollectButton } from "@/features/collect-g2b/ui/RecollectButton";
import { loadCollectionList } from "@/server/g2b/repository/load-collection-list";
import type {
  CollectionOverview,
  CollectionSection,
} from "@/server/g2b/repository/collection-attempts";
import { G2B_SECTIONS } from "@/shared/config/g2b-sections";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { G2bSectionNav } from "@/shared/ui/g2b/G2bSectionNav";
import { ADMIN_NAVIGATION } from "../../config/navigation";
import { ADMIN_G2B_PATH, collectionDetailPaths } from "../../config/routes";
import { CollectionQueryView } from "@/shared/ui/g2b/CollectionQueryView";
import { CollectionForm } from "./CollectionForm";
import {
  collectionCountFormat,
  collectionCountLabels,
} from "./collection-count-labels";
import { CollectionListItem } from "@/shared/ui/g2b/CollectionListItem";
import { CollectionListLabel } from "@/shared/ui/g2b/CollectionListLabel";
import { CollectionFailureDetails } from "./CollectionFailureDetails";

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

type DisplayRow = {
  item: TargetKey;
  savedItem?: Pick<CollectionOverview["saved"][number], "title" | "businessCode" | "businessLabel">;
  failure?: Pick<CollectionOverview["failures"][number], "id" | "startedAt" | "status" | "error" | "diagnostics">;
};

/**
 * URL에서 선택된 필터에 맞춰 저장 자료와 최신 실패 상태를 대상별 한 행으로 표시한다.
 * @param props.searchParams 수집 상태와 업무 목록에서 지원하는 검색·필터·정렬·페이지 조건.
 * @throws SQLite에서 업무 목록과 수집 이력을 읽지 못한 경우.
 */
export async function CollectionListPage({
  section,
  searchParams,
}: {
  section: CollectionSection;
  searchParams: Promise<CollectionSearchParams>;
}) {
  const params = await searchParams;
  const paginated = loadCollectionList(section, params);
  const { counts } = paginated.result;
  const selected = paginated.query.status;
  const rows = paginated.result.rows.map((row): DisplayRow => ({
    item: row,
    savedItem: row.collectedAt !== null ? row : undefined,
    failure: row.id !== null && row.startedAt && row.status && row.status !== "succeeded"
      ? { id: row.id, startedAt: row.startedAt, status: row.status, error: row.error, diagnostics: row.diagnostics }
      : undefined,
  }));
  const href = `${ADMIN_G2B_PATH}/${section}`;
  const items = <CollectionRows section={section} rows={rows} />;

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
      <G2bSectionNav items={ADMIN_NAVIGATION.g2b.sections} activeSection={section} />
      <CollectionForm section={section} />
      <nav
        aria-label="수집 상태로 필터링"
        className="grid grid-cols-3 overflow-hidden rounded-xl border bg-card"
      >
        {collectionCountLabels.map(([key, label]) => (
          <Link
            key={key}
            href={paginated.href(href, { ...paginated.query, status: key, page: 1 })}
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
      <CollectionQueryView
        path={href}
        query={{ ...paginated.query, page: paginated.result.page }}
        totalPages={paginated.result.totalPages}
        businesses={paginated.businesses}
        {...(paginated.section === "notices"
          ? { section: paginated.section, regions: paginated.regions }
          : { section: paginated.section })}
      >
        {items}
      </CollectionQueryView>
    </section>
  );
}

/** 저장 여부에 따라 상세 링크를 표시하고 최신 실패나 보류가 있으면 재수집을 제공한다. */
function CollectionRows({ section, rows }: { section: CollectionSection; rows: DisplayRow[] }) {
  return rows.length === 0 ? (
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
                  {failure.diagnostics && <CollectionFailureDetails diagnostics={failure.diagnostics} />}
                </>
              )
            }
          >
            <CollectionListLabel
              identifier={formatCollectionIdentifier(item)}
              title={savedItem?.title}
              businessCode={savedItem?.businessCode}
              businessLabel={savedItem?.businessLabel}
              uncollected={!savedItem}
            />
          </CollectionListItem>
        );
      })}
    </ul>
  );
}
