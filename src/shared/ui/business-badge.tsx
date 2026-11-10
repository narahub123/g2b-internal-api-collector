import type { G2bBusiness } from "@/shared/lib/g2b-business";
import { Badge } from "./badge";

/** 표시용 업무구분이 있는 경우 공통 색상과 문구를 적용한 배지를 표시한다. */
export function BusinessBadge({ business }: { business?: G2bBusiness }) {
  if (!business) return null;

  return (
    <Badge variant="secondary" className="business-badge" data-business-code={business.code}>
      {business.label}
    </Badge>
  );
}
