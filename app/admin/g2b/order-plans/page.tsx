import { CollectionListPage } from "@/_pages/admin/g2b/ui/CollectionListPage";
import type { CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";

/** 발주계획의 수집 현황과 URL 조회 조건이 적용된 목록을 표시한다. */
export default function Page({ searchParams }: { searchParams: Promise<CollectionSearchParams> }) {
  return <CollectionListPage section="order-plans" searchParams={searchParams} />;
}
