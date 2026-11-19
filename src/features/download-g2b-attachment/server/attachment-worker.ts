import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { getG2bDatabase } from "@/server/g2b/repository";
import { openAttachmentQueue } from "@/server/g2b/repository/attachment-queue";
import { listAttachmentJobs, preferredPdfFiles } from "./attachment-catalog";

/** 형식별 추출기는 임시 원본을 읽어 영구 저장 가능한 결과를 반환한다. */
export type AttachmentExtractor = (input: {
  temporaryPath: string; format: string; signal: AbortSignal;
}) => Promise<{ text: string; metadata?: Record<string, unknown> }>;

/** 추출 단계에서 소문자 확장자별로 실행할 도구를 등록하는 계약이다. */
export type AttachmentExtractorRegistry = Readonly<Partial<Record<string, AttachmentExtractor>>>;

type Queue = ReturnType<typeof openAttachmentQueue>;
type Claim = NonNullable<Awaited<ReturnType<Queue["claim"]>>>;

class PermanentDownloadError extends Error {}

/** 원본을 저장하지 않고 응답 전체를 읽어 해시를 반환하며, 실패나 중단은 호출자에 전달한다. */
export async function hashAttachmentBody(body: ReadableStream<Uint8Array>, signal: AbortSignal, expectedBytes?: number) {
  const hash = createHash("sha256");
  const reader = body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let bytes = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      hash.update(value);
      bytes += value.byteLength;
    }
    if (expectedBytes !== undefined && bytes !== expectedBytes) throw new Error("첨부 원본 크기가 목록과 다릅니다.");
    return hash.digest("hex");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function processClaim(queue: Queue, claim: Claim, stopping: AbortSignal) {
  const heartbeat = new AbortController();
  const lost = new AbortController();
  const signal = AbortSignal.any([stopping, lost.signal, AbortSignal.timeout(600_000)]);
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
      outcome = { hash: await hashAttachmentBody(response.body, signal, file.bytes) };
    } catch (error) {
      outcome = {
        error: error instanceof Error ? error.message.slice(0, 300) : "첨부 다운로드 실패",
        retry: !(error instanceof PermanentDownloadError),
      };
    }
    if (!lost.signal.aborted) await queue.finish(claim, outcome);
  } finally {
    heartbeat.abort();
    await renewal;
  }
}

/** 첨부 큐를 직렬로 처리하며 중단 요청 시 진행 중인 다운로드를 취소한다. */
export async function runAttachmentWorker(stopping: AbortSignal) {
  const queue = openAttachmentQueue(getG2bDatabase());
  while (!stopping.aborted) {
    try {
      const event = await queue.event();
      let consumed = false;
      if (event) {
        try {
          const files = await listAttachmentJobs({ section: event.section, number: event.number, revision: event.revision });
          await queue.consume(event.id, files.filter((file) => !preferredPdfFiles(file, files).length));
          consumed = true;
        } catch (error) {
          // 자동 인계 오류가 이미 등록된 수동 작업을 막지 않게 한다.
          console.error("[첨부 자동 등록]", event.id, error);
        }
      }
      if (stopping.aborted) return;
      const claim = await queue.claim();
      if (claim) {
        await processClaim(queue, claim, stopping);
        continue;
      }
      if (consumed) continue;
    } catch (error) {
      console.error("[첨부 워커]", error);
    }
    await delay(5_000, undefined, { signal: stopping }).catch(() => {});
  }
}
