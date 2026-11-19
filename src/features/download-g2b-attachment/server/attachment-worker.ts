import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openAttachmentQueue } from "@/server/g2b/repository/attachment-queue";
import { listAttachmentJobs, preferredPdfFiles } from "./attachment-catalog";
import { PDF_EXTRACTOR_VERSION, PDF_MAX_BYTES } from "@/shared/model/g2b/attachment-pdf";
import { cleanAbandonedPdfs, extractPdfProcess, PermanentPdfError, removeTemporaryPdf, temporaryPdfPath } from "./pdf-process";

/** 형식별 추출기는 임시 원본을 읽어 영구 저장 가능한 결과를 반환한다. */
export type AttachmentExtractor = (input: {
  temporaryPath: string; format: string; signal: AbortSignal;
}) => Promise<{ text: string; metadata?: Record<string, unknown> }>;

/** 추출 단계에서 소문자 확장자별로 실행할 도구를 등록하는 계약이다. */
export type AttachmentExtractorRegistry = Readonly<Partial<Record<string, AttachmentExtractor>>>;

type Queue = ReturnType<typeof openAttachmentQueue>;
type Claim = NonNullable<Awaited<ReturnType<Queue["claim"]>>>;

class PermanentDownloadError extends Error {}

/**
 * 응답을 한 번 읽어 원본 전체의 SHA-256을 계산하고, 추출이 필요한 PDF만 임시 파일에 쓴다.
 * @param signal 다운로드 중단 신호. 중단 시 스트림과 파일 핸들을 닫는다.
 * @param expectedBytes 목록에 저장된 크기. 값이 있으면 잘린 응답을 거부한다.
 * @param pdfPath 추출에 사용할 임시 경로. 호출자가 작업 종료 후 파일을 제거한다.
 * @throws 중단, 읽기·쓰기 실패 또는 파일 크기 검증 실패를 전달한다.
 */
export async function hashAttachmentBody(body: ReadableStream<Uint8Array>, signal: AbortSignal,
  expectedBytes?: number, pdfPath?: string) {
  const hash = createHash("sha256");
  const reader = body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let bytes = 0;
  let temporaryFile: Awaited<ReturnType<typeof open>> | undefined;
  try {
    signal.throwIfAborted();
    if (pdfPath) temporaryFile = await open(pdfPath, "wx", 0o600);
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (pdfPath && bytes > PDF_MAX_BYTES) throw new PermanentPdfError("PDF가 50 MiB 제한을 초과했습니다.");
      hash.update(value);
      if (temporaryFile) await temporaryFile.writeFile(value);
    }
    if (expectedBytes !== undefined && bytes !== expectedBytes) throw new Error("첨부 원본 크기가 목록과 다릅니다.");
    return hash.digest("hex");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await temporaryFile?.close();
  }
}

async function processClaim(queue: Queue, claim: Claim, stopping: AbortSignal) {
  const heartbeat = new AbortController();
  const lost = new AbortController();
  // 다운로드 제한은 네트워크 단계에만 적용하고 자식 추출은 자체 제한을 적용한다.
  const lifecycle = AbortSignal.any([stopping, lost.signal]);
  const signal = AbortSignal.any([lifecycle, AbortSignal.timeout(600_000)]);
  const pdfPath = claim.mode === "pdf_extract" ? temporaryPdfPath() : undefined;
  const renewal = (async () => {
    try {
      while (!heartbeat.signal.aborted) {
        await delay(30_000, undefined, { signal: heartbeat.signal });
        if (!await queue.renew(claim)) throw new Error("첨부 작업 실행권을 잃었습니다.");
      }
    } catch (error) {
      if (!heartbeat.signal.aborted) {
        lost.abort(error);
        console.error("[첨부 실행권 갱신 실패]", claim.file.id, error);
      }
    }
  })();
  try {
    let outcome: Parameters<Queue["finish"]>[1];
    try {
      const files = await listAttachmentJobs(claim.file.owner);
      const file = files.find(({ id }) => id === claim.file.id);
      if (!file || preferredPdfFiles(file, files).length) throw new PermanentDownloadError("현재 처리 가능한 첨부가 아닙니다.");
      if (pdfPath && file.bytes !== undefined && file.bytes > PDF_MAX_BYTES) {
        throw new PermanentPdfError("PDF가 50 MiB 제한을 초과했습니다.");
      }
      signal.throwIfAborted();
      const url = await file.resolve(signal);
      signal.throwIfAborted();
      if (!url || url.origin !== "https://www.g2b.go.kr") throw new PermanentDownloadError("다운로드 주소를 확인할 수 없습니다.");
      const response = await fetch(url, { signal, redirect: "error", cache: "no-store" });
      const htmlError = /^text\/html\b/i.test(response.headers.get("content-type") ?? "") &&
        !/\.html?$/i.test(file.filename);
      if (!response.ok || !response.body || htmlError) {
        await response.body?.cancel();
        if ([401, 403, 404, 410].includes(response.status)) throw new PermanentDownloadError("첨부 다운로드가 허용되지 않습니다.");
        throw new Error(`첨부 원본 응답을 확인할 수 없습니다 (HTTP ${response.status}).`);
      }
      const hash = await hashAttachmentBody(response.body, signal, file.bytes, pdfPath);
      if (pdfPath) {
        lifecycle.throwIfAborted();
        // 다운로드한 실제 바이트의 해시가 같은 경우에만 이 버전의 추출 결과를 재사용한다.
        const pdf = await queue.hasPdf(hash)
          ? { version: PDF_EXTRACTOR_VERSION }
          : await extractPdfProcess(pdfPath, lifecycle);
        lifecycle.throwIfAborted();
        outcome = { hash, pdf };
      } else {
        outcome = { hash };
      }
    } catch (error) {
      outcome = {
        error: error instanceof Error ? error.message.slice(0, 300) : "첨부 처리 실패",
        retry: !(error instanceof PermanentDownloadError || error instanceof PermanentPdfError),
      };
    }
    if (!lost.signal.aborted) {
      try {
        await queue.finish(claim, outcome);
      } catch (error) {
        if (!lost.signal.aborted) await queue.finish(claim, { error: "첨부 결과 저장 실패", retry: true });
        console.error("[첨부 결과 저장]", claim.file.id, error);
      }
    }
  } finally {
    heartbeat.abort();
    await renewal;
    if (pdfPath) await removeTemporaryPdf(pdfPath);
  }
}

/**
 * 수집 완료 이벤트와 첨부 큐를 독립적으로 처리한다.
 * 중단 시 신규 선점을 멈추고 진행 중인 다운로드·추출 및 임시 원본 정리를 마친다.
 * @throws 시작 시 임시 파일을 점검할 수 없으면 워커 시작 실패를 전달한다.
 */
export async function runAttachmentWorker(stopping: AbortSignal) {
  await cleanAbandonedPdfs();
  const queue = openAttachmentQueue(getG2bDatabase());
  while (!stopping.aborted) {
    try {
      const event = await queue.event();
      let eventAdvanced = Boolean(event);
      if (event) {
        try {
          const files = await listAttachmentJobs({ section: event.section, number: event.number, revision: event.revision });
          await queue.consume(event, files.filter((file) => !preferredPdfFiles(file, files).length));
        } catch (error) {
          // 자동 인계 오류가 이미 등록된 수동 작업을 막지 않게 한다.
          const message = error instanceof Error ? error.message : String(error);
          try {
            const result = await queue.failEvent(event, message);
            if (result) console.error("[첨부 자동 등록]", {
              id: event.id, section: event.section, number: event.number, revision: event.revision,
              failures: result.failures, ...(!result.failedAt ? { retryAt: result.retryAt } : { failedAt: result.failedAt }),
              error: message.slice(0, 300),
            });
          } catch (writeError) {
            console.error("[첨부 자동 등록 실패 기록]", event.id, writeError);
            // DB가 실패 상태를 기록할 수 없으면 같은 이벤트의 즉시 재조회를 피한다.
            eventAdvanced = false;
          }
        }
      }
      if (stopping.aborted) return;
      const claim = await queue.claim();
      if (claim) {
        await processClaim(queue, claim, stopping);
        continue;
      }
      if (eventAdvanced) continue;
    } catch (error) {
      console.error("[첨부 워커]", error);
    }
    await delay(5_000, undefined, { signal: stopping }).catch(() => {});
  }
}
