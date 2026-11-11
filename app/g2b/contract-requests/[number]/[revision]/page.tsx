import { G2bDetailPage } from "@/_pages/g2b/ui/G2bDetailPage";
import type { CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";

/** 사용자 상세에 계약요청 식별자와 목록 복귀 조건을 전달한다. */
export default function Page({ params, searchParams }: {
  params: Promise<{ number: string; revision: string }>;
  searchParams: Promise<CollectionSearchParams>;
}) {
  return <G2bDetailPage section="contract-requests" params={params} searchParams={searchParams} />;
}
