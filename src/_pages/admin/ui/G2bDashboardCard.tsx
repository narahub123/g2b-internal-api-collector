import { LandmarkIcon } from "lucide-react";
import type { G2bCollectionCounts } from "@/server/g2b/repository/types";
import { G2B_LABEL, G2B_SECTIONS } from "@/shared/config/g2b-sections";
import { ADMIN_G2B_PATH } from "../config/routes";
import { AdminDashboardCard } from "./AdminDashboardCard";

// 대시보드는 관리자 메뉴와 별도로 요청된 집계 순서를 사용한다.
const collectionSections = [
  "order-plans",
  "prior-specs",
  "notices",
  "contract-requests",
  "opening-results",
  "contracts",
] as const satisfies readonly (keyof G2bCollectionCounts)[];

const countFormatter = new Intl.NumberFormat("ko-KR");

/**
 * 조회한 나라장터 업무별 건수와 합계를 카드에 표시한다.
 * @param props.counts 같은 조회에서 가져온 여섯 업무의 저장 행 수.
 */
export function G2bDashboardCard({ counts }: { counts: G2bCollectionCounts }) {
  const total = collectionSections.reduce(
    (sum, section) => sum + counts[section],
    0,
  );

  return (
    <AdminDashboardCard
      href={ADMIN_G2B_PATH}
      title={G2B_LABEL}
      description="나라장터 데이터를 관리합니다."
      icon={<LandmarkIcon className="size-5" />}
    >
      <dl>
        <div className="mb-2 rounded-lg bg-muted/60 p-4 flex justify-between items-center">
          <dt className="text-sm text-muted-foreground">전체 수집 데이터</dt>
          <dd className="wrap-break-word text-md font-semibold tabular-nums">
            {countFormatter.format(total)}건
          </dd>
        </div>
        {collectionSections.map((section) => (
          <div
            key={section}
            className="flex justify-between gap-2 border-b py-2 text-sm last:border-b-0"
          >
            <dt className="text-muted-foreground">{G2B_SECTIONS[section]}</dt>
            <dd className="text-right font-medium tabular-nums">
              {countFormatter.format(counts[section])}건
            </dd>
          </div>
        ))}
      </dl>
    </AdminDashboardCard>
  );
}
