"use client";

import { useState } from "react";
import type { QualificationReviewDisplay } from "../model/qualification-review-display";
import { OpeningResultFieldSection } from "./OpeningResultFieldSection";
import { ResultTable } from "./ResultTable";

/**
 * 공고정보 값 영역에서 심사 상세와 업체별 판정 목록을 독립된 섹션으로 표시한다.
 * 첫 업체를 기본 선택하고, 선택을 바꾸면 원본 팝업처럼 업체별 상세 세 값만 갱신한다.
 * @param props 서버에서 표시 항목만 추린 적격심사 자료.
 */
export function QualificationReviewDetail({ review }: { review: QualificationReviewDisplay }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = review.rows[selectedIndex] ?? review.rows[0];
  const table = { columns: review.columns, rows: review.rows.map(({ cells }) => cells) };
  if (!selected) return null;

  return (
    <div className="grid min-w-0 gap-2">
      <OpeningResultFieldSection title="입찰공고 및 심사 상세정보">
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          {[...review.fields, ...selected.fields].map(({ key, label, value }) => (
            <div key={key} className="grid gap-1 sm:contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 wrap-anywhere whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      </OpeningResultFieldSection>
      <OpeningResultFieldSection title="업체별 판정결과">
        <div className="grid min-w-0 gap-2">
          <p className="text-muted-foreground">전체 {review.rows.length.toLocaleString("ko-KR")}건</p>
          <ResultTable
            table={table}
            onRowClick={setSelectedIndex}
            renderCell={(key, index) => key === "grpNm" ? (
              <button
                type="button"
                aria-pressed={review.rows[index] === selected}
                aria-label={review.rows[index].cells.grpNm || `${index + 1}번 업체`}
                className="cursor-pointer underline underline-offset-2 aria-pressed:font-semibold"
              >
                {review.rows[index].cells.grpNm}
              </button>
            ) : (review.rows[index].cells[key] ?? "")}
          />
        </div>
      </OpeningResultFieldSection>
    </div>
  );
}
