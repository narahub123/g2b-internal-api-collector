import type { CollectionSection } from "@/server/g2b/repository/collection-attempts";
import { revisionRoute, type NumberWithRevision } from "@/shared/lib/g2b/revision-route";

/** 업무별 식별자를 인코딩해 사용자 상세 주소를 만든다. 발주계획과 사전규격은 번호만 사용한다. */
export function userDetailPath(section: CollectionSection, key: NumberWithRevision) {
  const path = section === "order-plans" || section === "prior-specs"
    ? `/${section}/${encodeURIComponent(key.number)}`
    : revisionRoute(section, key);
  return `/g2b${path}`;
}

/**
 * 같은 업무 탭의 홈 목록 주소를 복원한다.
 * @param from 목록 링크에 담긴 주소. 다른 경로, 탭 또는 중복 탭이면 현재 업무의 기본 목록을 사용한다.
 */
export function userListReturnHref(section: CollectionSection, from: unknown) {
  if (typeof from === "string" && from.startsWith("/?") && !from.includes("#")) {
    const params = new URLSearchParams(from.slice(2));
    const sections = params.getAll("section");
    if (sections.length === 1 && sections[0] === section) return `/?${params}`;
  }
  return `/?section=${section}`;
}
