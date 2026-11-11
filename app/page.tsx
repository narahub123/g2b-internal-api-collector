import { G2bHomePage } from "@/_pages/g2b/ui/G2bHomePage";
import type { CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";

/** 홈의 URL 조회 조건을 나라장터 사용자 목록에 전달한다. */
export default function Page({ searchParams }: { searchParams: Promise<CollectionSearchParams> }) {
  return <G2bHomePage searchParams={searchParams} />;
}
