import { withPageAccess } from "@/server/auth/page-guard";
import { CollectionListPage } from "@/_pages/admin/g2b/ui/CollectionListPage";

/** 업무 목록에서 저장 현황과 선택된 수집 상태 목록을 표시한다. */
function Page({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  return <CollectionListPage section="opening-results" searchParams={searchParams} />;
}

// 업무 화면이 조회를 시작하기 전에 관리자 접근을 검증한다.
export default withPageAccess("/admin", Page);
