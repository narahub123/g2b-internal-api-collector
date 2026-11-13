import Link from "next/link";
import type { G2B_SECTIONS } from "@/shared/config/g2b-sections";
import { cn } from "@/shared/lib/utils";

type G2bSection = keyof typeof G2B_SECTIONS;

type G2bSectionNavProps = {
  items: readonly { section: G2bSection; label: string; href: string }[];
  activeSection: G2bSection;
};

/**
 * 화면에서 제공한 주소로 업무 목록을 연결하고 현재 업무를 시각 및 접근성 속성으로 표시한다.
 */
export function G2bSectionNav({ items, activeSection }: G2bSectionNavProps) {
  return (
    <nav aria-label="나라장터 업무 단계" className="flex flex-wrap gap-2 border-b pb-3">
      {items.map(({ section, label, href }) => {
        const isActive = section === activeSection;
        return (
          <Link
            key={section}
            href={href}
            prefetch={false}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring",
              isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
