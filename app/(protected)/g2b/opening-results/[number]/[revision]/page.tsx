import { G2bDetailPage } from "@/_pages/g2b/ui/G2bDetailPage";
import { withPageAccess } from "@/server/auth/page-guard";
import type { CollectionSearchParams } from "@/shared/model/g2b/collection-list-query";

/** 사용자 상세에 개찰결과 식별자와 목록 복귀 조건을 전달한다. */
function Page({ params, searchParams }: {
  params: Promise<{ number: string; revision: string }>;
  searchParams: Promise<CollectionSearchParams>;
}) {
  return <G2bDetailPage section="opening-results" params={params} searchParams={searchParams} />;
}

// 사용자 상세의 자료 조회 전에 회원 접근을 검증한다.
export default withPageAccess("/g2b", Page);
