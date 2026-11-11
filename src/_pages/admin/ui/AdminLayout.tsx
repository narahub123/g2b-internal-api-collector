import type { ReactNode } from "react";
import { AdminSidebar } from "./AdminSidebar";

export function AdminLayout({ children }: { children: ReactNode }) {
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
