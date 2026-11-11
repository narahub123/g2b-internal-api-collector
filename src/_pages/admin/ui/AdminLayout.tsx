import type { ReactNode } from "react";
import { AdminSidebar } from "./AdminSidebar";

/**
 * 관리자 헤더와 공통 본문을 배치하고 모든 하위 화면의 본문 폭과 바깥 여백을 적용한다.
 */
export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="border-b bg-card px-4 py-2">
        <div className="mx-auto w-full min-w-0 max-w-5xl">
          <AdminSidebar />
        </div>
      </header>
      <main data-slot="admin-content" className="min-w-0 px-4 py-8 sm:px-6">
        <div className="mx-auto w-full min-w-0 max-w-5xl">{children}</div>
      </main>
    </>
  );
}
