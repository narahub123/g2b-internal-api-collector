import { BookOpen } from "lucide-react";
import { ADMIN_DICTIONARIES_PATH } from "../config/routes";
import { AdminDashboardCard } from "../ui/AdminDashboardCard";
import { formatCount, getDictionaryCards } from "./dictionary-server";

/** 관리 랜딩에서 관리 기능의 진입 카드와 사전별 전체 건수를 표시한다. */
export async function ManagePage() {
  // 사전 목록 본문은 상세 화면에서만 읽고 여기서는 집계만 준비한다.
  const cards = await getDictionaryCards();
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">관리</h1>
      {/* 관리 기능을 추가할 때 같은 그리드에 이동 카드를 배치한다. */}
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <AdminDashboardCard href={ADMIN_DICTIONARIES_PATH} title="사전 목록" icon={<BookOpen className="size-5" />}>
          <dl className="space-y-2 text-sm">
            {cards.map(({ id, title, details, failed }) => (
              <div key={id} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{title}</dt>
                <dd>{failed ? "조회 실패" : formatCount(details?.total ?? 0)}</dd>
              </div>
            ))}
          </dl>
        </AdminDashboardCard>
      </div>
    </section>
  );
}
