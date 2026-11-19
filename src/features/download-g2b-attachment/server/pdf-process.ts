import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PdfExtraction } from "@/shared/model/g2b/attachment-pdf";

// 시작 시 청소 범위를 이 워커가 만든 파일로 한정하고 PID로 소유 프로세스를 확인한다.
const prefix = "g2b-attachment-pdf-";
const temporaryName = /^g2b-attachment-pdf-(\d+)-[a-f0-9-]{36}\.pdf$/;

/** 파일 크기나 형식 제한 위반을 일시적인 실행 오류와 구분한다. */
export class PermanentPdfError extends Error {}

/** 현재 워커에서만 사용하는 임시 PDF 경로를 만든다. 파일 생성은 호출자가 독점 모드로 수행한다. */
export function temporaryPdfPath() {
  return join(tmpdir(), `${prefix}${process.pid}-${randomUUID()}.pdf`);
}

/** 현재 작업의 원본을 폐기한다. 아직 파일을 만들지 않았으면 정상적으로 종료한다. */
export async function removeTemporaryPdf(path: string) {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** 강제 종료로 남은 파일만 청소한다. 같은 호스트의 살아 있는 워커 파일은 보존한다. */
export async function cleanAbandonedPdfs() {
  for (const entry of await readdir(tmpdir(), { withFileTypes: true })) {
    const match = temporaryName.exec(entry.name);
    if (!match || !entry.isFile()) continue;
    if (Number(match[1]) === process.pid) {
      // 컨테이너가 같은 PID로 다시 시작해도 이전 실행의 파일은 제거한다.
      await removeTemporaryPdf(join(tmpdir(), entry.name));
      continue;
    }
    try {
      process.kill(Number(match[1]), 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") await removeTemporaryPdf(join(tmpdir(), entry.name));
    }
  }
}

/**
 * 추출 자식 프로세스의 종료를 확인한 뒤 결과를 반환해 호출자가 임시 원본을 안전하게 정리할 수 있게 한다.
 * @param path 다운로드가 끝난 임시 PDF 경로.
 * @param signal 워커 종료 또는 작업 선점 상실을 알리는 신호.
 * @throws 실행·추출 실패, 중단 또는 5분 제한 초과 시 오류를 전달한다.
 */
export function extractPdfProcess(path: string, signal: AbortSignal): Promise<PdfExtraction> {
  const extraction = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
  extraction.throwIfAborted();
  return new Promise((resolveResult, reject) => {
    const child = fork(resolve("scripts/attachment-pdf-extract.cjs"), [path], {
      // 파서는 임시 파일만 읽으므로 DB 인증 정보가 들어 있는 부모 환경을 상속하지 않는다.
      env: { NODE_ENV: "production", PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      // 부모 워커와 함께 컨테이너 메모리를 사용하므로 자식의 V8 힙 상한을 둔다.
      execArgv: ["--max-old-space-size=256"],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      windowsHide: true,
    });
    let message: { result?: PdfExtraction; error?: string; permanent?: boolean } | undefined;
    let spawnError: Error | undefined;
    const abort = () => { child.kill("SIGKILL"); };
    extraction.addEventListener("abort", abort, { once: true });
    child.once("message", (value) => { message = value as typeof message; });
    child.once("error", (error) => { spawnError = error; });
    child.once("close", (code) => {
      extraction.removeEventListener("abort", abort);
      if (extraction.aborted) reject(signal.aborted ? signal.reason : new Error("PDF 추출 시간이 5분을 초과했습니다."));
      else if (spawnError) reject(spawnError);
      else if (code === 0 && message?.result) resolveResult(message.result);
      else if (message?.permanent) reject(new PermanentPdfError(message.error));
      else reject(new Error(message?.error ?? `PDF 추출 프로세스가 종료됐습니다 (${code}).`));
    });
    if (extraction.aborted) abort();
  });
}
