import { decodeHTMLStrict } from "entities";

// PDF.js 버전과 읽기 순서 알고리즘이 바뀌면 기존 결과와 별도 저장한다.
export const PDF_EXTRACTOR_VERSION = "6.4.299 / reading-order-v2";
// 워커와 파서가 같은 상한을 적용해 원본 버퍼와 페이지 리소스가 과도하게 늘어나는 것을 막는다.
export const PDF_MAX_BYTES = 50 * 1024 * 1024;
export const PDF_MAX_PAGES = 500;

/** 추출기가 페이지 순서대로 반환하는 텍스트와 결과 버전이다. */
export type PdfExtraction = {
  version: string;
  pages: { pageNumber: number; text: string }[];
  // 빈 텍스트 결과도 정상 완료로 저장하며 화면에서 이 값으로 구분한다.
  characterCount: number;
};

/** 나라장터 표시 인코딩을 해제한 파일명의 마지막 확장자로 PDF를 판별한다. */
export function isPdfAttachment(filename: string) {
  return /\.pdf$/i.test(decodeHTMLStrict(filename));
}
