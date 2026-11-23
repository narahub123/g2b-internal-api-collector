import Link from "next/link";
import { formatCollectionIdentifier } from "@/shared/model/g2b/collection-list-query";
import type { CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";
import { RecollectButton } from "@/features/collect-g2b/ui/RecollectButton";
import { CollectionListSelection, CollectionRowCheckbox } from "@/features/delete-g2b/ui/CollectionListSelection";
import { getG2bRepository } from "@/server/g2b/repository";
import { loadCollectionList } from "@/server/g2b/repository/load-collection-list";
import type { CollectionDeletionTarget } from "@/server/g2b/repository/collection-deletion";
import type {
  CollectionOverview,
  CollectionSection,
} from "@/server/g2b/repository/collection-attempts";
import { G2B_SECTIONS } from "@/shared/config/g2b-sections";
import { cn } from "@/shared/lib/utils";
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
import { AdminPageHeading } from "./AdminPageHeading";

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
  deletionTarget?: CollectionDeletionTarget;
  savedItem?: Pick<CollectionOverview["saved"][number], "title" | "businessCode" | "businessLabel">;
  failure?: Pick<CollectionOverview["failures"][number], "id" | "startedAt" | "status" | "error" | "diagnostics">;
};

/**
 * URL에서 선택된 필터에 맞춰 저장 자료와 최신 실패 상태를 대상별 한 행으로 표시한다.
 * @param props.searchParams 수집 상태와 업무 목록에서 지원하는 검색·필터·정렬·페이지 조건.
 * @throws Turso에서 업무 목록과 수집 이력을 읽지 못한 경우.
 */
export async function CollectionListPage({
  section,
  searchParams,
}: {
  section: CollectionSection;
  searchParams: Promise<CollectionSearchParams>;
}) {
  const params = await searchParams;
  const paginated = await loadCollectionList(section, params);
  const { counts } = paginated.result;
  const selected = paginated.query.status;
  const deletion = getG2bRepository().collectionDeletion;
  const rows = await Promise.all(paginated.result.rows.map(async (row): Promise<DisplayRow> => {
    const { target, blocked } = await deletion.snapshot(section, row);
    // 화면을 조회한 뒤 다른 프로세스가 원본이나 이력을 바꿨다면 새 버전을 대신 제출하지 않는다.
    const eligible = !blocked && row.status !== "pending" &&
      (row.collectedAt !== null || row.status === "failed" || row.status === "deferred") &&
      target.collectedAt === row.collectedAt && target.attemptId === row.id && target.attemptStartedAt === row.startedAt;
    return {
      item: row,
      deletionTarget: eligible ? target : undefined,
      savedItem: row.collectedAt !== null ? row : undefined,
      failure: row.id !== null && row.startedAt && row.status && row.status !== "succeeded"
        ? { id: row.id, startedAt: row.startedAt, status: row.status, error: row.error, diagnostics: row.diagnostics }
        : undefined,
    };
  }));
  const href = `${ADMIN_G2B_PATH}/${section}`;

  return (
    <section className="grid min-w-0 gap-6">
      <AdminPageHeading
        title={G2B_SECTIONS[section]}
        backHref={ADMIN_G2B_PATH}
        backLabel="나라장터로 돌아가기"
      />
      <G2bSectionNav
        items={ADMIN_NAVIGATION.g2b.sections}
        activeSection={section}
      />
      <CollectionForm section={section} />
      <nav
        aria-label="수집 상태로 필터링"
        className="grid grid-cols-3 overflow-hidden rounded-xl border bg-card"
      >
        {collectionCountLabels.map(([key, label]) => (
          <Link
            key={key}
            href={paginated.href(href, {
              ...paginated.query,
              status: key,
              page: 1,
            })}
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
        {rows.length === 0 ? (
          <CollectionRows section={section} rows={rows} />
        ) : (
          <CollectionListSelection
            key={paginated.href(href, paginated.query)}
            section={section}
            eligible={rows.flatMap(({ deletionTarget }) =>
              deletionTarget ? [deletionTarget] : [],
            )}
          >
            <CollectionRows section={section} rows={rows} />
          </CollectionListSelection>
        )}
      </CollectionQueryView>
    </section>
  );
}

/** 삭제 선택과 저장 상세 링크를 독립된 컨트롤로 표시하고 최신 실패나 보류에 재수집을 제공한다. */
function CollectionRows({ section, rows }: { section: CollectionSection; rows: DisplayRow[] }) {
  return rows.length === 0 ? (
    <p className="text-sm text-muted-foreground">
      해당하는 자료가 없습니다.
    </p>
  ) : (
    <ul className="grid gap-2">
      {rows.map(({ item, savedItem, failure, deletionTarget }) => {
        const key = targetKey(item);
        const identifier = formatCollectionIdentifier(item);
        return (
          <CollectionListItem
            key={key}
            href={savedItem ? collectionDetailPaths[section](item) : undefined}
            selection={<CollectionRowCheckbox identifier={identifier} disabled={!deletionTarget} />}
            action={
              failure && (
                <RecollectButton
                  endpoint={`/api/g2b/collection-attempts/${failure.id}/retry?startedAt=${encodeURIComponent(failure.startedAt)}`}
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
              identifier={identifier}
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
