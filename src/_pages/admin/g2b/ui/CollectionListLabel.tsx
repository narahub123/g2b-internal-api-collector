import { resolveG2bBusiness } from "@/shared/lib/g2b/g2b-business";
import { BusinessBadge } from "@/shared/ui/g2b/BusinessBadge";
import { UncollectedBadge } from "@/shared/ui/g2b/UncollectedBadge";
import { decodeHTMLStrict } from "entities";

/**
 * 모든 업무의 목록 행에서 제목, 식별자, 업무 배지 순서로 표시한다.
 * 제목이 비어 있으면 식별자를 바로 표시하고, 업무구분이 없으면 배지를 생략한다.
 * @param props.uncollected 저장 자료가 없을 때만 업무 배지 옆에 미수집을 표시한다.
 */
export function CollectionListLabel({ identifier, title, businessCode, businessLabel, uncollected }: {
  identifier: string;
  title?: string | null;
  businessCode?: string | null;
  businessLabel?: string | null;
  uncollected?: boolean;
}) {
  const displayTitle = typeof title === "string" ? decodeHTMLStrict(title).trim() : "";
  return (
    <span className="wrap-anywhere">
      {displayTitle ? `${displayTitle} (${identifier})` : identifier}{" "}
      <BusinessBadge business={resolveG2bBusiness(businessCode, businessLabel)} />
      {uncollected && <>{" "}<UncollectedBadge /></>}
    </span>
  );
}
