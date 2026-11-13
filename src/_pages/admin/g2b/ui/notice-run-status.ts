import type { NoticeJobStatus } from "@/server/g2b/repository/notice-queue-types";

// 목록과 상세에서 같은 공고 상태 문구를 사용한다.
export const noticeRunJobLabels: Record<NoticeJobStatus, string> = {
  pending: "대기",
  running: "수집 중",
  retry_wait: "재시도 대기",
  succeeded: "성공",
  failed: "실패",
};
