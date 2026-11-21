import { decodeHTMLStrict } from "entities";

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

/** 추출기가 원본 순서대로 반환하는 텍스트다. 빈 텍스트도 결과로 저장한다. */
export type AttachmentExtraction = { units: string[] };

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

const extractors = new Map([[pdfExtractor.format, pdfExtractor]]);

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
