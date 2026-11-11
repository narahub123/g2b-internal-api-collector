import { CollectionListPage } from "@/_pages/admin/g2b/ui/CollectionListPage";
import type { NoticeSearchParams } from "@/entities/notice/model/notice-list-query";

/** 입찰공고의 수집 현황과 URL 조회 조건이 적용된 목록을 표시한다. */
export default function Page({ searchParams }: { searchParams: Promise<NoticeSearchParams> }) {
  return <CollectionListPage section="notices" searchParams={searchParams} />;
}
