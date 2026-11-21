import { decodeHTMLStrict } from "entities";
import type { AttachmentDocument } from "./attachment-document";

/** 큐와 워커가 공유하는 형식 식별자, 결과 버전, 격리 실행 설정이다. */
export type AttachmentExtractor = {
  format: string;
  version: string;
  // 자식 진입점은 argv[2]로 임시 원본을 받고 IPC로 결과 또는 실패를 한 번 보낸다.
  entrypoint: string;
  maxBytes: number;
  timeoutMs: number;
  maxOldSpaceMiB: number;
};

/** 기존 텍스트 추출기와 구조화 추출기의 IPC 결과를 구분한다. */
export type AttachmentExtraction = { units: string[] } | { document: AttachmentDocument };

/** 상세 화면에서 저장 결과를 한 단위씩 조회하는 데 필요한 정보다. */
export type AttachmentPreview = { resultId: number; unitCount: number; signature: string; format: string };

/** 첨부 출처와 그룹 내 순번으로 저장 결과를 찾는다. */
export type AttachmentPreviewLookup = (
  source: string, group: string | undefined, seq: string,
) => AttachmentPreview | undefined;

// 버전은 파서 또는 텍스트 출력 방식이 바뀔 때 갱신해 캐시를 분리한다.
export const pdfExtractor: AttachmentExtractor = {
  format: "pdf",
  version: "6.4.299 / reading-order-v2",
  entrypoint: "scripts/attachment-pdf-extract.cjs",
  maxBytes: 50 * 1024 * 1024,
  timeoutMs: 300_000,
  maxOldSpaceMiB: 256,
};

// 동일 진입점을 사용해도 캐시와 화면에서는 원본 확장자를 구분한다.
const supportedFormats = [
  "pdf", "hwp", "hwpx", "hml", "hwpml", "xls", "xlsx", "docx", "pptx",
  "png", "jpg", "jpeg", "webp", "tif", "tiff", "gif", "bmp", "avif", "heic", "heif", "pcx", "dcx",
];
const extractors = new Map<string, AttachmentExtractor>(supportedFormats.map((format) => [format, {
  format,
  version: "kordoc/4.25.2 / document-v1",
  entrypoint: "scripts/attachment-kordoc-extract.cjs",
  maxBytes: pdfExtractor.maxBytes,
  timeoutMs: pdfExtractor.timeoutMs,
  maxOldSpaceMiB: 512,
}]));

/** 나라장터 표시 인코딩을 해제하고 파일명의 마지막 확장자만 소문자로 정규화한다. */
export function attachmentNameParts(filename: string) {
  const name = decodeHTMLStrict(filename);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot + 1).toLowerCase() }
    : { stem: name, extension: "" };
}

/** 첨부의 확장자에 등록된 추출기를 찾는다. 미등록 형식은 해시 확인만 수행한다. */
export function findAttachmentExtractor(filename: string) {
  return extractors.get(attachmentNameParts(filename).extension);
}
