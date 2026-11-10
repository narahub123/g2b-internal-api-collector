import { decodeHTMLStrict } from "entities";
import { formatG2bDisplayDateTime } from "@/shared/lib/g2b-display-format";

type RawResponse = Record<string, unknown>;

export type NoticePost = {
  bbsNo: string;
  pstNo: string;
  detail?: RawResponse;
  body?: RawResponse;
  attachments?: RawResponse;
};

export type NoticePosts = {
  list: RawResponse;
  entries: NoticePost[];
};

/** 공지 응답의 데이터맵과 목록 행을 읽되 원본 값을 변환하지 않는다. */
export function noticePostRecord(value: unknown): RawResponse {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawResponse)
    : {};
}

function display(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? decodeHTMLStrict(String(value))
    : "";
}

/** 목록의 날짜 우선순위와 원본 화면의 40자 제목 제한을 적용한다. */
export function noticePostTitle(row: RawResponse) {
  const title = display(row.pstNm);
  return `(${formatG2bDisplayDateTime(display(row.chgDt || row.inptDt))}) ${title.length > 40 ? title.slice(0, 40) + "..." : title}`;
}

/** 게시물 상세의 필드 순서와 공고번호·차수 행 표시 조건을 적용한다. */
export function noticePostFields(detail: RawResponse) {
  const rows = [
    [{ label: "게시물분류", value: display(detail.bbsClsfPritmNm) }],
    [
      {
        label: "최종수정일시",
        value: formatG2bDisplayDateTime(display(detail.chgDt || detail.inptDt)),
      },
    ],
  ];
  // 원본은 입찰공고 게시판에서 번호와 차수 중 하나라도 있으면 두 필드를 함께 표시한다.
  if (
    detail.bbsNo === "R23AB00000204" &&
    (display(detail.odn1ColCn) !== "" || display(detail.odn2ColCn) !== "")
  ) {
    rows.push([
      { label: "입찰공고번호", value: display(detail.odn1ColCn) },
      { label: "입찰공고차수", value: display(detail.odn2ColCn) },
    ]);
  }
  rows.push([{ label: "제목", value: display(detail.pstNm) }]);
  return rows;
}

/** 원본 목록 순서에 맞춰 게시글 키와 목록 표시 데이터를 함께 반환한다. */
export function noticePostRows(list: RawResponse) {
  if (!Array.isArray(list.dlPstL))
    throw new Error("공지사항 목록 응답이 올바르지 않습니다.");
  return list.dlPstL.map((value) => {
    const row = noticePostRecord(value);
    const bbsNo = typeof row.bbsNo === "string" ? row.bbsNo : "";
    const pstNo =
      typeof row.pstNo === "string" || typeof row.pstNo === "number"
        ? String(row.pstNo)
        : "";
    if (!bbsNo || !pstNo) throw new Error("공지사항 게시글 키가 없습니다.");
    return { row, bbsNo, pstNo };
  });
}
