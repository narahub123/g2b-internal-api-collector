import { CollectionListPage } from "@/_pages/admin/g2b/ui/CollectionListPage";

/** 업무 목록에서 저장 현황과 선택된 수집 상태 목록을 표시한다. */
export default function Page({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  return <CollectionListPage section="prior-specs" searchParams={searchParams} />;
}
