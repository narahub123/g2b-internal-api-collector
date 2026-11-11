import type { ReactNode } from "react";

export function G2bLayout({ children }: { children: ReactNode }) {
  return <div className="min-w-0">{children}</div>;
}
