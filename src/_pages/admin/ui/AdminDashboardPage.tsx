import { connection } from "next/server";
import { getG2bRepository } from "@/server/g2b/repository";
import { G2bDashboardCard } from "./G2bDashboardCard";
import { Settings } from "lucide-react";
import { AdminDashboardCard } from "./AdminDashboardCard";
import { ADMIN_MANAGE_PATH } from "../config/routes";

/**
 * 요청 시점에 저장된 나라장터 업무별 건수를 조회해 관리자 대시보드에 표시한다.
 * @throws Turso 저장소를 열거나 저장 건수를 집계하지 못한 경우.
 */
export default async function AdminDashboardPage() {
  await connection();
  const counts = await getG2bRepository().getCollectionCounts();

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">관리자 대시보드</h1>
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <G2bDashboardCard counts={counts} />
        {/* 관리 기능으로 이동하는 카드를 기존 나라장터 카드 옆에 표시한다. */}
        <AdminDashboardCard href={ADMIN_MANAGE_PATH} title="관리" icon={<Settings className="size-5" />} />
      </div>
    </section>
  );
}
