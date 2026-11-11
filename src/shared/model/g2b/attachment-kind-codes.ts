/**
 * 나라장터 입찰공고 첨부파일 문서구분 공통 코드.
 * 출처: selectCommCdList.do, dlCommGrpCdM.commGrpCd = "첨02PN037"
 * 원본: www.g2b.go.kr7.har
 * cdNm / cdSplmNm의 HTML 문자 참조는 일반 문자열로 변환하여 저장했다.
 */
export const NOTICE_ATTACHMENT_KIND_CODES = [
  { code: "첨020297", name: "공고서", detailName: "공고서(원본)", order: 1 },
  { code: "첨020417", name: "공고서(변환본)", detailName: "공고서(변환본)", order: 2 },
  { code: "첨020033", name: "규격서", detailName: "규격서", order: 3 },
  { code: "첨020066", name: "제안요청서", detailName: "제안요청서", order: 4 },
  { code: "첨020298", name: "내역서", detailName: "내역서", order: 5 },
  { code: "첨020299", name: "영문요약서", detailName: "영문요약서", order: 6 },
  { code: "첨020300", name: "과업지시서", detailName: "과업지시서", order: 7 },
  { code: "첨020301", name: "설계지침서", detailName: "설계지침서", order: 8 },
  { code: "첨020329", name: "최종제안요청서 교부안내서", detailName: "최종제안요청서 교부안내서", order: 9 },
  { code: "첨020330", name: "최종제안요청서", detailName: "최종제안요청서", order: 10 },
  { code: "첨020109", name: "기타문서", detailName: "기타", order: 11 },
] as const;

const noticeAttachmentKindMap = new Map<string, (typeof NOTICE_ATTACHMENT_KIND_CODES)[number]>(
  NOTICE_ATTACHMENT_KIND_CODES.map((item) => [item.code, item]),
);

/** 알 수 없는 코드는 숨기지 않고 원본 코드를 반환한다. */
export function getNoticeAttachmentKindName(
  code: string | null | undefined,
  useDetailName = false,
): string {
  if (!code) return "";
  const item = noticeAttachmentKindMap.get(code);
  if (!item) return code;
  return useDetailName ? item.detailName : item.name;
}
