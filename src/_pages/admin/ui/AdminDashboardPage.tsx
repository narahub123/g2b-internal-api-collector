import { connection } from "next/server";
import { getG2bRepository } from "@/server/g2b/repository";
import { G2bDashboardCard } from "./G2bDashboardCard";
import { Settings } from "lucide-react";
import { AdminDashboardCard } from "./AdminDashboardCard";
import { ADMIN_MANAGE_PATH } from "../config/routes";
import { dictionaries } from "../manage/dictionaries";

/**
 * 요청 시점에 저장된 나라장터 업무별 건수를 조회해 관리자 대시보드에 표시한다.
 * @throws Turso 저장소를 열거나 저장 건수를 집계하지 못한 경우.
 */
export default async function AdminDashboardPage() {
  await connection();
  const counts = await getG2bRepository().getCollectionCounts();
  // 관리 카드에는 저장 자료를 조회하지 않고 등록된 사전의 종류만 센다.
  const dictionaryCount = dictionaries.length;

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">관리자 대시보드</h1>
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <G2bDashboardCard counts={counts} />
        {/* 관리 기능으로 이동하는 카드를 기존 나라장터 카드 옆에 표시한다. */}
        <AdminDashboardCard
          href={ADMIN_MANAGE_PATH}
          title="관리"
          description="사전 목록 등 관리 기능을 제공합니다."
          icon={<Settings className="size-5" />}
        >
          {/* 나라장터 카드와 같은 강조 영역에 사전 종류 수를 표시한다. */}
          <dl className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 p-4">
            <dt className="text-sm text-muted-foreground">사전 목록 관리</dt>
            <dd className="text-md font-semibold tabular-nums">{dictionaryCount.toLocaleString("ko-KR")}종</dd>
          </dl>
        </AdminDashboardCard>
      </div>
    </section>
  );
}
