import Link from "next/link";
import { useId, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/shared/ui/card";

// 카드마다 이동 경로와 헤더를 지정하고 본문은 필요한 경우에만 제공한다.
type AdminDashboardCardProps = {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  children?: ReactNode;
};

/**
 * 관리자 기능의 제목을 접근성 이름으로 사용하는 카드 전체 링크를 렌더링한다.
 * @param props.icon 접근성 트리에서 숨기는 장식 아이콘. 포커스 가능한 요소를 전달하지 않는다.
 * @param props.children 선택 본문. 카드 전체가 링크이므로 본문에 링크나 버튼을 중첩하지 않는다.
 */
export function AdminDashboardCard({
  href,
  title,
  description,
  icon,
  children,
}: AdminDashboardCardProps) {
  const titleId = useId();

  return (
    <Link
      href={href}
      aria-labelledby={titleId}
      className="group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <Card className="transition-colors group-hover:border-primary/50 gap-3">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-muted p-2 text-foreground" aria-hidden="true">
              {icon}
            </span>
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children == null ? null : <CardContent>{children}</CardContent>}
      </Card>
    </Link>
  );
}
