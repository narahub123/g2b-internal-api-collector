import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openAttachmentQueue } from "@/server/g2b/repository/attachment-queue";
import { openAttachmentDispatch } from "@/server/g2b/repository/attachment-dispatch";
import {
  ATTACHMENT_ADMISSION_TIMEOUT_MS,
  ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
  ATTACHMENT_IDLE_POLL_MS,
  ATTACHMENT_LEASE_RENEWAL_MS,
} from "@/shared/config/g2b-attachment-worker";
import { listAttachmentJobs, preferredPdfFiles } from "./attachment-catalog";
import { findAttachmentExtractor, type AttachmentExtractor } from "@/shared/model/g2b/attachment-extraction";
import { cleanAbandonedAttachments, runExtractionProcess, PermanentExtractionError, removeTemporaryAttachment, temporaryAttachmentPath } from "./extraction-process";

type Queue = ReturnType<typeof openAttachmentQueue>;
type Claim = NonNullable<Awaited<ReturnType<Queue["claim"]>>>;

class PermanentDownloadError extends Error {}

/**
 * 응답을 한 번 읽어 원본 전체의 SHA-256을 계산하고, 추출이 필요한 첨부만 임시 파일에 쓴다.
 * @param signal 다운로드 중단 신호. 중단 시 스트림과 파일 핸들을 닫는다.
 * @param expectedBytes 목록에 저장된 크기. 값이 있으면 잘린 응답을 거부한다.
 * @param temporary 추출기의 크기 제한과 임시 경로. 호출자가 작업 종료 후 파일을 제거한다.
 * @throws 중단, 읽기·쓰기 실패 또는 파일 크기 검증 실패를 전달한다.
 */
export async function hashAttachmentBody(body: ReadableStream<Uint8Array>, signal: AbortSignal,
  expectedBytes?: number, temporary?: { path: string; extractor: AttachmentExtractor }) {
  const hash = createHash("sha256");
  const reader = body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let bytes = 0;
  let temporaryFile: Awaited<ReturnType<typeof open>> | undefined;
  try {
    signal.throwIfAborted();
    if (temporary) temporaryFile = await open(temporary.path, "wx", 0o600);
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (temporary && bytes > temporary.extractor.maxBytes) throw sizeLimitError(temporary.extractor);
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

function sizeLimitError(extractor: AttachmentExtractor) {
  const limitMiB = extractor.maxBytes / (1024 * 1024);
  return new PermanentExtractionError(extractor.format.toUpperCase() + "가 " + limitMiB + " MiB 제한을 초과했습니다.");
}

async function processClaim(queue: Queue, claim: Claim, stopping: AbortSignal, resolveExtractor: typeof findAttachmentExtractor) {
  const heartbeat = new AbortController();
  const lost = new AbortController();
  // 다운로드 제한은 네트워크 단계에만 적용하고 자식 추출은 자체 제한을 적용한다.
  const lifecycle = AbortSignal.any([stopping, lost.signal]);
  const signal = AbortSignal.any([lifecycle, AbortSignal.timeout(ATTACHMENT_DOWNLOAD_TIMEOUT_MS)]);
  let temporaryPath: string | undefined;
  const renewal = (async () => {
    try {
      while (!heartbeat.signal.aborted) {
        await delay(ATTACHMENT_LEASE_RENEWAL_MS, undefined, { signal: heartbeat.signal });
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
      const extractor = claim.mode === "extract" ? resolveExtractor(file.filename) : undefined;
      if (claim.mode === "extract" && !extractor) throw new PermanentExtractionError("등록된 첨부 추출기가 없습니다.");
      if (extractor) {
        if (file.bytes !== undefined && file.bytes > extractor.maxBytes) throw sizeLimitError(extractor);
        temporaryPath = temporaryAttachmentPath();
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
      const temporary = extractor && temporaryPath ? { path: temporaryPath, extractor } : undefined;
      const hash = await hashAttachmentBody(response.body, signal, file.bytes, temporary);
      if (temporary) {
        lifecycle.throwIfAborted();
        // 원본 해시가 같아도 형식과 추출 버전이 일치할 때만 재사용한다.
        const { format, version } = temporary.extractor;
        const result = await queue.hasExtraction(hash, temporary.extractor) ? undefined
          : await runExtractionProcess(temporary.extractor, temporary.path, lifecycle);
        lifecycle.throwIfAborted();
        outcome = { hash, extraction: { format, version, result } };
      } else {
        outcome = { hash };
      }
    } catch (error) {
      outcome = {
        error: error instanceof Error ? error.message.slice(0, 300) : "첨부 처리 실패",
        retry: !(error instanceof PermanentDownloadError || error instanceof PermanentExtractionError),
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
    if (temporaryPath) await removeTemporaryAttachment(temporaryPath);
  }
}

/**
 * 수집 완료 이벤트와 첨부 큐를 독립적으로 처리한다.
 * 중단 시 신규 선점을 멈추고 진행 중인 다운로드·추출 및 임시 원본 정리를 마친다.
 * @param options 예약 실행은 전달된 토큰을 소비하며 일회 실행은 큐가 비면 종료한다. 추출기 조회를 주입하면 큐와 실행에 함께 적용한다.
 * @throws 실행권 갱신이나 큐 접근에 실패한 경우.
 */
export async function runAttachmentWorker(stopping: AbortSignal, options: {
  once?: boolean; reservation?: string; resolveExtractor?: typeof findAttachmentExtractor;
} = {}) {
  if (stopping.aborted) return;
  const db = getG2bDatabase();
  const lease = await openAttachmentDispatch(db).acquireWorker(options.reservation);
  if (!lease) return;
  const heartbeat = new AbortController();
  const lost = new AbortController();
  // 파일이 없거나 목록을 확인 중일 때도 워커 전체 실행권을 유지한다.
  const renewal = (async () => {
    try {
      while (!heartbeat.signal.aborted) {
        await delay(ATTACHMENT_LEASE_RENEWAL_MS, undefined, { signal: heartbeat.signal });
        if (!await lease.renew()) throw new Error("첨부 워커 실행권을 잃었습니다.");
      }
    } catch (error) {
      if (!heartbeat.signal.aborted) lost.abort(error);
    }
  })();
  try {
    await cleanAbandonedAttachments();
    const resolveExtractor = options.resolveExtractor ?? findAttachmentExtractor;
    await drainAttachmentQueue(openAttachmentQueue(db, lease.token, resolveExtractor),
      AbortSignal.any([stopping, lost.signal]), Boolean(options.once), resolveExtractor);
    lost.signal.throwIfAborted();
  } finally {
    heartbeat.abort();
    await renewal;
    await lease.release();
  }
}

async function drainAttachmentQueue(queue: Queue, stopping: AbortSignal, once: boolean,
  resolveExtractor: typeof findAttachmentExtractor) {
  // 시간 한도는 새 작업을 받는 데만 적용한다. 다운로드·추출의 취소 신호와 분리한다.
  const deadline = once ? performance.now() + ATTACHMENT_ADMISSION_TIMEOUT_MS : Infinity;
  const canStart = () => !stopping.aborted && performance.now() < deadline;
  while (canStart()) {
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
            if (once) throw writeError;
            console.error("[첨부 자동 등록 실패 기록]", event.id, writeError);
            // DB가 실패 상태를 기록할 수 없으면 같은 이벤트의 즉시 재조회를 피한다.
            eventAdvanced = false;
          }
        }
      }
      if (!canStart()) return;
      const claim = await queue.claim();
      if (claim) {
        await processClaim(queue, claim, stopping, resolveExtractor);
        continue;
      }
      if (eventAdvanced) continue;
    } catch (error) {
      if (once) throw error;
      console.error("[첨부 워커]", error);
    }
    if (once) return;
    await delay(ATTACHMENT_IDLE_POLL_MS, undefined, { signal: stopping }).catch(() => {});
  }
}
