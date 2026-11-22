import { withPageAccess } from "@/server/auth/page-guard";
import { CollectionListPage } from "@/_pages/admin/g2b/ui/CollectionListPage";
import type { NoticeSearchParams } from "@/entities/notice/model/notice-list-query";

/** 입찰공고의 수집 현황과 URL 조회 조건이 적용된 목록을 표시한다. */
function Page({ searchParams }: { searchParams: Promise<NoticeSearchParams> }) {
  return <CollectionListPage section="notices" searchParams={searchParams} />;
}

// 업무 화면이 조회를 시작하기 전에 관리자 접근을 검증한다.
export default withPageAccess("/admin", Page);
