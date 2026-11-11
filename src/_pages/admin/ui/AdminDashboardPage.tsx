import { LandmarkIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { getG2bRepository } from "@/server/g2b/repository";
import type { G2bCollectionCounts } from "@/server/g2b/repository/types";
import { G2B_LABEL, G2B_SECTIONS } from "@/shared/config/g2b-sections";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/shared/ui/card";
import { ADMIN_G2B_PATH } from "../config/routes";

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
 * 요청 시점에 저장된 나라장터 업무별 건수를 조회해 관리자 대시보드에 표시한다.
 * @throws SQLite 저장소를 열거나 저장 건수를 집계하지 못한 경우.
 */
export default async function AdminDashboardPage() {
  await connection();
  const counts = getG2bRepository().getCollectionCounts();
  const total = collectionSections.reduce(
    (sum, section) => sum + counts[section],
    0,
  );

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">관리자 대시보드</h1>
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Link
          href={ADMIN_G2B_PATH}
          aria-labelledby="g2b-card-title"
          className="group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <Card className="transition-colors group-hover:border-primary/50">
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-muted p-2 text-foreground">
                  <LandmarkIcon className="size-5" aria-hidden="true" />
                </span>
                <h2 id="g2b-card-title" className="text-lg font-semibold">
                  {G2B_LABEL}
                </h2>
              </div>
              <CardDescription>
                나라장터 수집 데이터를 조회하고 관리합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl>
                <div className="mb-4 rounded-lg bg-muted/60 p-4">
                  <dt className="text-sm text-muted-foreground">
                    전체 수집 데이터
                  </dt>
                  <dd className="mt-1 break-words text-3xl font-semibold tabular-nums">
                    {countFormatter.format(total)}건
                  </dd>
                </div>
                {collectionSections.map((section) => (
                  <div
                    key={section}
                    className="flex justify-between gap-2 border-b py-2 text-sm last:border-b-0"
                  >
                    <dt className="text-muted-foreground">
                      {G2B_SECTIONS[section]}
                    </dt>
                    <dd className="text-right font-medium tabular-nums">
                      {countFormatter.format(counts[section])}건
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </Link>
      </div>
    </section>
  );
}
