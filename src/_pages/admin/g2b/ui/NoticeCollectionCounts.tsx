import type { NoticeCollectionCounts as Counts } from "@/server/g2b/repository/notice-queue-types";
import { collectionCountFormat } from "./collection-count-labels";

const labels = [
  ["total", "전체"], ["pending", "대기"], ["running", "수집 중"], ["completed", "완료"], ["failed", "실패"],
] as const;

/**
 * 자동 수집과 전체 큐의 집계를 같은 순서와 강조 방식으로 표시한다.
 * @param props.onFailedClick 실패 건수가 있을 때 실패 목록으로 이동하는 동작.
 */
export function NoticeCollectionCounts({ counts, onFailedClick }: { counts: Counts; onFailedClick?: () => void }) {
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-5">
      {labels.map(([key, label]) => (
        <div key={key}>
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className={`font-semibold tabular-nums${key === "failed" ? " text-destructive" : ""}`}>
            {key === "failed" && counts.failed > 0 && onFailedClick ? (
              <button type="button" className="cursor-pointer underline underline-offset-4"
                aria-label={`실패 ${collectionCountFormat.format(counts.failed)}건, 실패 목록 보기`}
                onClick={onFailedClick}>
                {collectionCountFormat.format(counts.failed)}건
              </button>
            ) : `${collectionCountFormat.format(counts[key])}건`}
          </dd>
        </div>
      ))}
    </dl>
  );
}
