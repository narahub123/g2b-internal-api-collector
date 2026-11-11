import { connection } from "next/server";
import { getG2bRepository } from "@/server/g2b/repository";
import { G2bDashboardCard } from "./G2bDashboardCard";

/**
 * 요청 시점에 저장된 나라장터 업무별 건수를 조회해 관리자 대시보드에 표시한다.
 * @throws SQLite 저장소를 열거나 저장 건수를 집계하지 못한 경우.
 */
export default async function AdminDashboardPage() {
  await connection();
  const counts = getG2bRepository().getCollectionCounts();

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">관리자 대시보드</h1>
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <G2bDashboardCard counts={counts} />
      </div>
    </section>
  );
}
