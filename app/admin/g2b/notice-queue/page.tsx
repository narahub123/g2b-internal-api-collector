import { withPageAccess } from "@/server/auth/page-guard";
import { Suspense } from "react";
import { NoticeQueuePage } from "@/_pages/admin/g2b/ui/NoticeQueuePage";

/** 주소의 페이지 번호를 사용하는 클라이언트 큐 화면을 로딩 경계 안에서 제공한다. */
function NoticeQueueRoute() {
  return (
    <Suspense fallback={<h1 className="text-2xl font-semibold">공고 수집 큐</h1>}>
      <NoticeQueuePage />
    </Suspense>
  );
}

// 업무 화면이 조회를 시작하기 전에 관리자 접근을 검증한다.
export default withPageAccess("/admin", NoticeQueueRoute);
