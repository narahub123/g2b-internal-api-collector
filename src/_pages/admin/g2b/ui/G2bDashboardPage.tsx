import {
  ClipboardList,
  FileCheck,
  FileSearch,
  Gavel,
  ListChecks,
  Megaphone,
} from "lucide-react";
import { connection } from "next/server";
import { getG2bRepository } from "@/server/g2b/repository";
import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import { ADMIN_NAVIGATION } from "../../config/navigation";
import { AdminDashboardCard } from "../../ui/AdminDashboardCard";
import {
  collectionCountFormat,
  collectionCountLabels,
} from "./collection-count-labels";
import { cn } from "@/shared/lib/utils";
import { NoticePeriodCollection } from "./NoticePeriodCollection";
import { NoticeAutomaticSettings } from "./NoticeAutomaticSettings";
import { AdminPageHeading } from "./AdminPageHeading";
import { ADMIN_HOME_PATH } from "../../config/routes";

// 카드의 업무 아이콘은 메뉴의 여섯 업무와 일치한다.
const sectionIcons = {
  "order-plans": ClipboardList,
  "contract-requests": ListChecks,
  "prior-specs": FileSearch,
  notices: Megaphone,
  "opening-results": Gavel,
  contracts: FileCheck,
} satisfies Record<CollectionSection, typeof ClipboardList>;

/**
 * 업무별 현황과 목록 링크 아래에 공고 기간 수집과 자동 수집 설정을 제공한다.
 * @throws Turso 저장소를 열거나 수집 현황을 읽지 못한 경우.
 */
export async function G2bDashboardPage() {
  await connection();
  const history = getG2bRepository().collectionAttempts;

  return (
    <section className="space-y-6">
      <AdminPageHeading
        title={ADMIN_NAVIGATION.g2b.label}
        backHref={ADMIN_HOME_PATH}
        backLabel="관리자로 돌아가기"
      />
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ADMIN_NAVIGATION.g2b.sections.map(async ({ section, href, label }) => {
          const Icon = sectionIcons[section];
          const counts = await history.counts(section);
          const hasUncollected = counts.uncollected > 0;
          return (
            <AdminDashboardCard
              key={section}
              href={href}
              title={label}
              icon={<Icon className="size-5" />}
              warning={hasUncollected}
            >
              <dl className="grid grid-cols-3 gap-2">
                {collectionCountLabels.map(([key, name]) => (
                  <div key={key} className="min-w-0">
                    <dt
                      className={cn(
                        "text-xs text-muted-foreground",
                        key === "uncollected" && "text-destructive",
                      )}
                    >
                      {name}
                    </dt>
                    <dd
                      className={cn(
                        "wrap-anywhere text-sm font-semibold tabular-nums",
                        key === "uncollected" && "text-destructive",
                      )}
                    >
                      {collectionCountFormat.format(counts[key])}건
                    </dd>
                  </div>
                ))}
              </dl>
            </AdminDashboardCard>
          );
        })}
      </div>
      <NoticePeriodCollection />
      <NoticeAutomaticSettings />
    </section>
  );
}
