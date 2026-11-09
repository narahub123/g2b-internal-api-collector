import { decodeHTMLStrict } from "entities";
import { formatAttachmentFileSize } from "@/shared/model/attachment-file-size";
import type { publicAttachmentFiles } from "@/shared/model/g2b-attachments";

// 각 상세 화면에서 공통으로 사용하는 첨부파일 데이터 형식이다.
type AttachmentFile = ReturnType<typeof publicAttachmentFiles>[number];

type AttachmentTableProps = {
  files: readonly AttachmentFile[];
  /** 입찰공고 파일첨부와 제안요청정보에서 문서구분 열을 표시한다. */
  showDocumentType?: boolean;
  /** 파일크기 정보가 없는 제안요청정보에서는 false로 설정한다. */
  showFileSize?: boolean;
  /** 각 상세 화면에서 생성한 다운로드 경로를 전달받는다. */
  getDownloadHref: (file: AttachmentFile) => string | undefined;
};

/**
 * 나라장터 첨부파일을 화면별 열 구성에 맞춰 공통 테이블로 표시한다.
 *
 * 발주계획·사전규격: 파일명 / 파일크기
 * 입찰공고 파일첨부: 문서구분 / 파일명 / 파일크기
 * 입찰공고 제안요청정보: 문서구분 / 파일명
 *
 * 파일의 수집·공개 여부 판단과 다운로드 URL 생성은 각 화면에서 처리한다.
 * 이 컴포넌트는 전달받은 파일을 원래 배열 순서대로 표시한다.
 */
export function AttachmentTable({
  files,
  showDocumentType = false,
  showFileSize = true,
  getDownloadHref,
}: AttachmentTableProps) {
  // 파일명은 항상 표시하고, 선택적으로 표시하는 열의 수를 더한다.
  // 빈 목록 메시지의 colSpan에도 실제 표시 열 개수를 적용한다.
  const columnCount = 1 + Number(showDocumentType) + Number(showFileSize);

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm" aria-label="파일첨부">
        <thead className="bg-secondary">
          <tr>
            {showDocumentType && (
              <th scope="col" className="whitespace-nowrap px-3 py-2">
                문서구분
              </th>
            )}
            <th scope="col" className="whitespace-nowrap px-3 py-2">
              파일명
            </th>
            {/* 제안요청정보는 파일크기 열을 표시하지 않는다. */}
            {showFileSize && (
              <th scope="col" className="whitespace-nowrap px-3 py-2">
                파일크기
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {files.length === 0 && (
            <tr className="border-t">
              <td
                colSpan={columnCount}
                className="px-3 py-2 text-center text-muted-foreground"
              >
                조회된 내역이 없습니다.
              </td>
            </tr>
          )}
          {files.map((file) => {
            // 다운로드가 허용된 파일에만 링크를 연결한다.
            // 다운로드 URL은 각 화면의 기존 생성 로직을 그대로 사용한다.
            const href = file.downloadable ? getDownloadHref(file) : undefined;
            const filename = decodeHTMLStrict(file.filename);

            return (
              <tr key={file.seq} className="border-t">
                {showDocumentType && (
                  <td className="whitespace-pre-wrap px-3 py-2">
                    {file.documentType
                      ? decodeHTMLStrict(file.documentType)
                      : ""}
                  </td>
                )}
                <td className="wrap-anywhere whitespace-pre-wrap px-3 py-2">
                  {href ? (
                    <a
                      href={href}
                      className="text-primary underline underline-offset-2"
                    >
                      {filename}
                    </a>
                  ) : (
                    filename
                  )}
                </td>
                {showFileSize && (
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatAttachmentFileSize(file.fileSize) ?? ""}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
