import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import { G2B_SECTIONS } from "@/shared/config/g2b-sections";
import { getG2bRepository } from "@/server/g2b/repository";
import type { CollectionOverview, CollectionSection } from "@/server/g2b/repository/collection-attempts";
import { RecollectButton } from "@/features/collect-g2b/ui/RecollectButton";
import {
  ADMIN_G2B_PATH, contractPath, contractRequestPath, openingResultPath, orderPlanPath, priorSpecPath,
} from "../../config/routes";
import { NoticesPage } from "../notices/ui/NoticesPage";

const numberFormat = new Intl.NumberFormat("ko-KR");
const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul",
});

const countLabels = { total: "전체", collected: "수집", uncollected: "미수집" } as const;
const failureLabels = { failed: "실패", deferred: "점검 보류", pending: "결과 미확인" } as const;

const detailPaths = {
  "order-plans": ({ number }) => orderPlanPath(number),
  "contract-requests": contractRequestPath,
  "prior-specs": ({ number }) => priorSpecPath(number),
  "opening-results": openingResultPath,
  contracts: contractPath,
} satisfies Record<Exclude<CollectionSection, "notices">, (key: CollectionOverview["saved"][number]) => string>;

function targetLabel({ number, revision, openingRevision }: Pick<CollectionOverview["saved"][number], "number" | "revision" | "openingRevision">) {
  return [number, revision && `차수 ${revision}`, openingRevision && `개찰 ${openingRevision}차`]
    .filter(Boolean).join(" · ");
}

/**
 * 저장된 대상 키와 수집 시각을 표시하고 업무별 상세 화면으로 연결한다.
 */
function SavedCollectionList({ section, saved }: {
  section: Exclude<CollectionSection, "notices">;
  saved: CollectionOverview["saved"];
}) {
  if (saved.length === 0) return <p className="text-sm text-muted-foreground">저장된 자료가 없습니다.</p>;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {saved.map((target) => (
        <li key={`${target.number}/${target.revision}/${target.openingRevision}`}>
          <Link href={detailPaths[section](target)} prefetch={false}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50 focus-visible:outline-ring">
            <span className="break-all text-sm font-medium">{targetLabel(target)}</span>
            <time dateTime={target.collectedAt} className="text-xs text-muted-foreground">
              {dateFormat.format(new Date(target.collectedAt))}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * 최신 실패·보류·미확인 상태와 저장 자료 유무를 표시하고 이력에 저장된 입력으로 재시도한다.
 */
function CollectionFailureList({ failures }: { failures: CollectionOverview["failures"] }) {
  if (failures.length === 0) return <p className="text-sm text-muted-foreground">수집 실패 내역이 없습니다.</p>;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {failures.map((attempt) => (
        <li key={attempt.id} className="flex flex-wrap items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <p className="break-all font-medium">{targetLabel(attempt)}</p>
            <p className="text-xs text-muted-foreground">
              <time dateTime={attempt.startedAt}>{dateFormat.format(new Date(attempt.startedAt))}</time>
              {" · "}{failureLabels[attempt.status]}{" · "}{attempt.hasData ? "저장 자료 있음" : "저장 자료 없음"}
            </p>
            {attempt.error && <p className="break-words text-destructive">{attempt.error}</p>}
          </div>
          <RecollectButton endpoint={`/api/g2b/collection-attempts/${attempt.id}/retry`} refreshOnError />
        </li>
      ))}
    </ul>
  );
}

/**
 * 업무별 저장 현황을 읽고 쿼리 문자열에 따라 수집 목록이나 실패 목록을 표시한다.
 * @param props.searchParams tab=failed를 전달하면 실패 목록을 연다.
 * @throws SQLite 저장소를 열거나 업무 목록을 조회하지 못한 경우.
 */
export async function CollectionListPage({ section, searchParams }: {
  section: CollectionSection;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const failed = (await searchParams).tab === "failed";
  const { counts, saved, failures } = getG2bRepository().collectionAttempts.overview(section);
  const href = `${ADMIN_G2B_PATH}/${section}`;

  return (
    <section className="grid min-w-0 gap-6">
      <h1 className="text-2xl font-semibold">{G2B_SECTIONS[section]}</h1>
      <dl className="grid grid-cols-3 divide-x rounded-xl border bg-card">
        {Object.entries(countLabels).map(([key, label]) => (
          <div key={key} className="min-w-0 px-3 py-4 sm:px-5">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all text-xl font-semibold tabular-nums">
              {numberFormat.format(counts[key as keyof typeof counts])}건
            </dd>
          </div>
        ))}
      </dl>
      <nav aria-label="수집 목록 보기" className="flex gap-4 border-b">
        {[
          { href, active: !failed, label: "수집 목록" },
          { href: `${href}?tab=failed`, active: failed, label: "수집 실패" },
        ].map((tab) => (
          <Link key={tab.href} href={tab.href} aria-current={tab.active ? "page" : undefined}
            className={cn("border-b-2 px-1 pb-2 text-sm font-medium", tab.active
              ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {tab.label}
          </Link>
        ))}
      </nav>
      {failed ? <CollectionFailureList failures={failures} /> : section === "notices"
        ? <NoticesPage /> : <SavedCollectionList section={section} saved={saved} />}
    </section>
  );
}
