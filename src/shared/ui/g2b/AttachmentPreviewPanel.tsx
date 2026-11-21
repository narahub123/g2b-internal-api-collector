"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AttachmentPreview } from "@/shared/model/g2b/attachment-extraction";
import type { DocumentUnit } from "@/shared/model/g2b/attachment-document";
import { AttachmentDocumentBlocks } from "./AttachmentDocumentBlocks";
import { Button } from "@/shared/ui/button";
import { ListView } from "@/shared/ui/list-controls/ListView";

type Preview = AttachmentPreview & { filename: string; rowKey: string };
type UnitResponse = { pageNumber: number } & ({ text: string } | { document: DocumentUnit });
const locationLabels = { page: "페이지", section: "구역", sheet: "시트", slide: "슬라이드" };

const PreviewContext = createContext<{
  panelId: string;
  activeRow?: string;
  open: (file: Preview) => void;
} | null>(null);

/** 테이블의 선택 상태를 관리하고 선택한 파일의 미리보기를 바로 아래에 표시한다. */
export function AttachmentPreviewPanel({ children }: { children: ReactNode }) {
  const panelId = useId();
  const [selection, setSelection] = useState<{ file: Preview; page: number }>();

  return (
    <PreviewContext.Provider value={{
      panelId,
      activeRow: selection?.file.rowKey,
      open: (file) => setSelection({ file, page: 1 }),
    }}>
      <div className="grid min-w-0 gap-3">
        {children}
        {selection && (
          <TextUnitPreview
            id={panelId}
            file={selection.file}
            page={selection.page}
            onPageChange={(page) => setSelection({ file: selection.file, page })}
            onClose={() => setSelection(undefined)}
          />
        )}
      </div>
    </PreviewContext.Provider>
  );
}

/** 해당 행을 선택하고 파일의 첫 페이지를 테이블 하단에 연다. */
export function AttachmentPreviewButton({ file }: { file: Preview }) {
  const panel = useContext(PreviewContext);
  if (!panel) return null;
  const expanded = panel.activeRow === file.rowKey;
  return (
    <Button type="button" size="sm" variant="outline" aria-expanded={expanded}
      aria-controls={expanded ? panel.panelId : undefined} aria-label={`${file.filename} 추출 내용 보기`}
      onClick={() => panel.open(file)}>
      보기
    </Button>
  );
}

/** 현재 페이지를 처음 열 때만 조회하고 성공한 본문은 탭의 메모리에서 재사용한다. */
function TextUnitPreview({ id, file, page, onPageChange, onClose }: {
  id: string;
  file: Preview;
  page: number;
  onPageChange: (page: number) => void;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["attachment-result-unit", file.resultId, page],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async (): Promise<UnitResponse> => {
      const response = await fetch(`/api/g2b/attachment-results/${file.resultId}/pages/${page}`, {
        headers: { "X-Attachment-Pdf-Signature": file.signature },
      });
      if (!response.ok) throw new Error("추출 내용을 조회하지 못했습니다.");
      return response.json();
    },
  });

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid min-w-0 gap-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 id={`${id}-title`} className="min-w-0 wrap-anywhere font-medium">{file.filename}</h4>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>닫기</Button>
      </div>
      <ListView pagination={{ page, totalPages: file.unitCount, onPageChange }}>
        <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">{page} / {file.unitCount} {file.format === "pdf" ? "페이지" : "단위"}</p>
        {query.isPending ? <p role="status">추출 내용을 불러오는 중입니다.</p>
          : query.isError ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert">추출 내용을 조회하지 못했습니다.</p>
              <Button type="button" size="sm" variant="outline" disabled={query.isFetching}
                onClick={() => void query.refetch()}>다시 시도</Button>
            </div>
          ) : "document" in query.data ? (
            <div className="grid min-w-0 gap-2">
              {query.data.document.location && <p className="text-sm text-muted-foreground">
                {locationLabels[query.data.document.location.kind]} {query.data.document.location.number}
              </p>}
              {query.data.document.warnings?.map((warning, index) => (
                <p key={index} className="wrap-anywhere text-sm">
                  {warning.page ? `${warning.page}쪽 · ` : ""}{warning.message}
                </p>
              ))}
              {query.data.document.blocks.length > 0
                ? <AttachmentDocumentBlocks blocks={query.data.document.blocks} />
                : <p>추출된 내용이 없습니다.</p>}
            </div>
          ) : query.data.text.trim() ? (
            <pre className="max-h-[32rem] overflow-auto wrap-anywhere whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
              {query.data.text}
            </pre>
          ) : <p>추출된 텍스트가 없습니다.</p>}
      </ListView>
    </section>
  );
}
