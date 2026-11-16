/** 관리자 화면에서 선택할 수 있는 자동 수집 주기(분). */
export const noticeAutomaticIntervals = [30, 60, 120] as const;

export type NoticeAutomaticInterval = (typeof noticeAutomaticIntervals)[number];

export type NoticeAutomaticCommand =
  | { action: "start"; interval: NoticeAutomaticInterval; startMinute: string }
  | { action: "stop" }
  | { action: "interval"; interval: NoticeAutomaticInterval };

export type NoticeAutomaticSettings = {
  enabled: boolean;
  interval: NoticeAutomaticInterval;
  startMinute: string | null;
  nextAt: number | null;
  status: "stopped" | "stopping" | "scheduled" | "pending" | "running" | "maintenance" | "queue_paused";
};

/** 기간 수집과 같은 한국 현지 분 단위 형식으로 실행 시각을 고정한다. */
export function noticeKoreanMinute(timestamp: number): string {
  return new Date(timestamp + 9 * 60 * 60_000).toISOString().slice(0, 16);
}
