import { Suspense } from "react";
import { NoticeQueuePage } from "@/_pages/admin/g2b/ui/NoticeQueuePage";

/** 주소의 페이지 번호를 사용하는 클라이언트 큐 화면을 로딩 경계 안에서 제공한다. */
export default function NoticeQueueRoute() {
  return (
    <Suspense fallback={<h1 className="text-2xl font-semibold">공고 수집 큐</h1>}>
      <NoticeQueuePage />
    </Suspense>
  );
}
