import type { ReactNode } from "react";
import { AdminSidebar } from "./_components/admin-sidebar";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="border-b bg-card px-4 py-2">
        <AdminSidebar />
      </header>
      <div data-slot="admin-content" className="min-w-0">
        {children}
      </div>
    </>
  );
}
