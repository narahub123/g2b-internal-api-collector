import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { BusinessBadge } from "@/shared/ui/g2b/BusinessBadge";
import { decodeHTMLStrict } from "entities";

/**
 * 모든 업무의 목록 행에서 제목, 식별자, 업무 배지 순서로 표시한다.
 * 제목이 비어 있으면 식별자를 바로 표시하고, 업무구분이 없으면 배지를 생략한다.
 */
export function CollectionListLabel({ identifier, title, businessCode, businessLabel }: {
  identifier: string;
  title?: string | null;
  businessCode?: string | null;
  businessLabel?: string | null;
}) {
  const displayTitle = typeof title === "string" ? decodeHTMLStrict(title).trim() : "";
  return (
    <span className="wrap-anywhere">
      {displayTitle ? `${displayTitle} (${identifier})` : identifier}{" "}
      <BusinessBadge business={resolveG2bBusiness(businessCode, businessLabel)} />
    </span>
  );
}
