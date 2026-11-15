import { decodeHTMLStrict } from "entities";
import { formatG2bDisplayDateTime } from "@/shared/lib/g2b/g2b-display-format";
import type { QualificationReview } from "./opening-result";
import type { DisplayTable } from "./opening-result-display";

const noticeFields = [
  ["bidPbancNoOrd", "입찰공고번호"], ["bidClsfNo", "입찰분류"], ["bidPbancNm", "공고명"],
  ["edocNo", "참조번호"], ["areaNm", "지역"], ["dmstGrpNm", "수요기관"], ["onbsPrnmntDt", "개찰일시"],
] as const;

const vendorFields = [
  ["srngRltDt", "심사결과등록일시"], ["objcLdggDt", "이의신청접수기한"], ["objcCn", "유의사항"],
] as const;

// 심사점수와 사유는 원본 표의 열만 유지하고 익명 조회에서는 값을 전달하지 않는다.
const columns = [
  { key: "No", label: "No" },
  { key: "bzmnRegNo", label: "사업자등록번호" },
  { key: "grpNm", label: "상호명" },
  { key: "qlemRslt", label: "처리상태(판정)" },
  { key: "srch", label: "심사점수" },
  { key: "srch2", label: "심사제외 사유" },
] satisfies DisplayTable["columns"];

type ReviewField = { key: string; label: string; value: string };

export type QualificationReviewDisplay = {
  fields: ReviewField[];
  columns: DisplayTable["columns"];
  rows: { cells: Record<string, string>; fields: ReviewField[] }[];
};

function displayText(value: unknown): string {
  if (typeof value === "string") return decodeHTMLStrict(value);
  return typeof value === "number" ? String(value) : "";
}

/**
 * 원본 팝업이 표시하는 공고 필드와 업체별 셀만 추려 클라이언트에 전달할 모델을 구성한다.
 * 선택 행에 따라 바뀌는 상세 값도 업체별로 담으며, 빈 값은 라벨을 유지할 수 있도록 보존한다.
 */
export function getQualificationReviewDisplay(review: QualificationReview): QualificationReviewDisplay {
  const { bidPbanc, areaNm } = review.bidResponse;
  const fields = noticeFields.map(([key, label]) => {
    const value = displayText(key === "areaNm" ? areaNm : bidPbanc[key]);
    return { key, label, value: key === "onbsPrnmntDt" ? formatG2bDisplayDateTime(value) : value };
  });
  const rows = review.judgmentResponse.qlemRsltJdgmntList.map((row, index) => ({
    cells: {
      No: String(index + 1),
      bzmnRegNo: displayText(row.bzmnRegNo).replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3"),
      grpNm: displayText(row.grpNm),
      qlemRslt: displayText(row.qlemRslt),
      srch: "",
      srch2: "",
    },
    fields: vendorFields.map(([key, label]) => {
      const value = displayText(row[key]);
      return { key, label, value: key === "objcCn" ? value : formatG2bDisplayDateTime(value) };
    }),
  }));
  return { fields, columns, rows };
}
