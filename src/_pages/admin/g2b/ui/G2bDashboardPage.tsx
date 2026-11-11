import { ClipboardList, FileCheck, FileSearch, Gavel, ListChecks, Megaphone } from "lucide-react";
import { connection } from "next/server";
import { getG2bRepository } from "@/server/g2b/repository";
import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import { ADMIN_NAVIGATION } from "../../config/navigation";
import { AdminDashboardCard } from "../../ui/AdminDashboardCard";

// 카드의 업무 아이콘은 메뉴의 여섯 업무와 일치한다.
const sectionIcons = {
  "order-plans": ClipboardList,
  "contract-requests": ListChecks,
  "prior-specs": FileSearch,
  notices: Megaphone,
  "opening-results": Gavel,
  contracts: FileCheck,
} satisfies Record<CollectionSection, typeof ClipboardList>;

const numberFormat = new Intl.NumberFormat("ko-KR");

/**
 * 요청 시점에 업무별 저장 건수를 조회하고 각 업무 목록으로 이동하는 카드를 표시한다.
 * @throws SQLite 저장소를 열거나 저장 건수를 읽지 못한 경우.
 */
export async function G2bDashboardPage() {
  await connection();
  const counts = getG2bRepository().getCollectionCounts();

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{ADMIN_NAVIGATION.g2b.label}</h1>
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ADMIN_NAVIGATION.g2b.sections.map(({ section, href, label }) => {
          const Icon = sectionIcons[section];
          return (
            <AdminDashboardCard key={section} href={href} title={label}
              description={`저장 ${numberFormat.format(counts[section])}건`}
              icon={<Icon className="size-5" />} />
          );
        })}
      </div>
    </section>
  );
}
