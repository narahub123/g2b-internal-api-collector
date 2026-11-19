import { randomUUID } from "node:crypto";
import { isPdfAttachment, PDF_EXTRACTOR_VERSION, type PdfExtraction } from "@/shared/model/g2b/attachment-pdf";
import type { G2bDatabase } from "./database";

/** 수집 자료를 다시 읽을 때 사용하는 업무별 식별자다. */
export type AttachmentOwner = { section: "notices" | "order-plans" | "prior-specs"; number: string; revision: string };

/** 공개 목록의 행과 기존 다운로드 경로를 재현하는 데 필요한 정보다. */
export type AttachmentJobFile = {
  id: string; filename: string; owner: AttachmentOwner; source: string;
  group: string; seq: string; path?: string; bytes?: number;
};

type Mode = "hash_only" | "pdf_extract";
type Claim = { file: AttachmentJobFile; token: string; attempts: number; mode: Mode };
type Outcome = { hash: string; pdf?: PdfExtraction | { version: string } } | { error: string; retry: boolean };
type AttachmentEvent = AttachmentOwner & { id: number; failures: number; generation: number };

// 운영자가 실패 횟수를 초기화한 뒤에도 이전 처리 결과를 거부할 수 있도록 세대를 함께 확인한다.
const currentEvent = "id = ? AND failures = ? AND generation = ? AND failed_at IS NULL";
const eventRetrySeconds = [30, 60, 120] as const;

// 페이지 단위 왕복을 줄이면서 일반적인 PDF의 바인딩 크기를 제한한다.
function* pageBatches(pages: PdfExtraction["pages"]) {
  let batch: string[] = [];
  let bytes = 2;
  for (const page of pages) {
    const entry = JSON.stringify([page.pageNumber, page.text]);
    const entryBytes = Buffer.byteLength(entry) + 1;
    if (batch.length && bytes + entryBytes > 128 * 1024) {
      yield `[${batch.join(",")}]`;
      batch = [];
      bytes = 2;
    }
    batch.push(entry);
    bytes += entryBytes;
  }
  if (batch.length) yield `[${batch.join(",")}]`;
}

/** 첨부 전용 상태와 실행권을 관리한다. 외부 다운로드 중에는 트랜잭션을 열어 두지 않는다. */
export function openAttachmentQueue(db: G2bDatabase) {
  const insert = db.prepare(`INSERT INTO g2b_attachment_jobs(id,file,priority,mode) VALUES (?,?,?,?)
    ON CONFLICT(id) DO NOTHING`);
  const read = db.prepare(`SELECT j.status, j.priority, j.attempts, j.hash, j.error, j.mode,
    j.pdf_result_id AS pdfResultId, r.character_count AS characterCount
    FROM g2b_attachment_jobs j LEFT JOIN g2b_attachment_pdf_results r ON r.id = j.pdf_result_id WHERE j.id = ?`);
  const findPdf = db.prepare("SELECT id FROM g2b_attachment_pdf_results WHERE hash = ? AND version = ?");
  const ownsJob = "id = ? AND token = ? AND status = 'running' AND expires_at > unixepoch()";
  return {
    /**
     * 수동 PDF 요청은 이전 해시 확인 작업도 추출로 승격하며 저장된 결과를 재사용한다.
     * @returns 작업 상태와 신규 등록·승격·재대기로 실행 요청이 필요한지를 반환한다.
     * @throws DB 조회나 저장 실패 시 등록 트랜잭션을 롤백한다.
     */
    enqueue(file: AttachmentJobFile, manual: boolean) {
      return db.transaction(async () => {
        const extract = manual && isPdfAttachment(file.filename);
        const inserted = await insert.run(file.id, JSON.stringify(file), Number(manual), extract ? "pdf_extract" : "hash_only");
        let changed = Boolean(inserted.rowsAffected);
        if (extract) {
          const current = await read.get(file.id);
          if (!current) return;
          if (current.pdfResultId != null) return { job: current, shouldDispatch: false };
          const cached = typeof current.hash === "string" && current.status !== "running"
            ? await findPdf.get(current.hash, PDF_EXTRACTOR_VERSION) : undefined;
          // 이미 수동 추출 대기 중인 작업은 다시 제출해도 새 실행을 예약하지 않는다.
          const alreadyPending = current.status === "pending" && current.priority === 1 && current.mode === "pdf_extract";
          if (alreadyPending && !cached) return { job: current, shouldDispatch: changed };
          await db.prepare(`UPDATE g2b_attachment_jobs SET priority = 1, mode = 'pdf_extract',
            status = CASE WHEN status = 'running' THEN status WHEN ? IS NOT NULL THEN 'succeeded' ELSE 'pending' END,
            pdf_result_id = ?, available_at = 0,
            attempts = CASE WHEN mode = 'hash_only' OR status IN ('failed','succeeded') THEN 0 ELSE attempts END,
            error = NULL WHERE id = ?`).run(cached?.id ?? null, cached?.id ?? null, file.id);
          changed = true;
        } else if (manual) {
          const updated = await db.prepare(`UPDATE g2b_attachment_jobs SET priority = 1, status = 'pending', available_at = 0,
            attempts = CASE WHEN status = 'failed' THEN 0 ELSE attempts END, error = NULL
            WHERE id = ? AND (status IN ('retry_wait', 'failed') OR (status = 'pending' AND priority = 0))`).run(file.id);
          changed ||= Boolean(updated.rowsAffected);
        }
        const current = await read.get(file.id);
        return current && { job: current, shouldDispatch: manual && changed && current.status === "pending" };
      });
    },
    /** 현재 파일의 상태와 해시를 관리자 화면에 반환한다. */
    status(id: string) { return read.get(id); },
    /** 동일한 바이트와 추출기 버전으로 저장된 PDF 결과가 있는지 확인한다. */
    async hasPdf(hash: string) { return Boolean(await findPdf.get(hash, PDF_EXTRACTOR_VERSION)); },
    /** DB 시각에 실행 가능한 가장 이른 수집 이벤트를 반환한다. */
    async event() {
      return await db.prepare(`SELECT id, section, number, revision, failures, generation FROM g2b_attachment_events
        WHERE failed_at IS NULL AND available_at <= unixepoch() ORDER BY available_at, id LIMIT 1`)
        .get() as AttachmentEvent | undefined;
    },
    /** 현재 이벤트의 삭제와 등록을 함께 확정한다. 이미 처리된 시도는 false를 반환한다. */
    consume(event: AttachmentEvent, files: AttachmentJobFile[]) {
      return db.transaction(async () => {
        const deleted = await db.prepare(`DELETE FROM g2b_attachment_events WHERE ${currentEvent}`)
          .run(event.id, event.failures, event.generation);
        if (!deleted.rowsAffected) return false;
        for (const file of files) {
          await insert.run(file.id, JSON.stringify(file), 0, isPdfAttachment(file.filename) ? "pdf_extract" : "hash_only");
        }
        return true;
      });
    },
    /** 최신 시도만 지연하거나 최종 실패로 기록한다. 다른 워커에서 처리했다면 결과가 없다. */
    async failEvent(event: AttachmentEvent, error: string) {
      const retry = eventRetrySeconds[event.failures];
      return db.prepare(`UPDATE g2b_attachment_events SET failures = failures + 1, error = ?,
        available_at = unixepoch() + ?, failed_at = CASE WHEN ? THEN unixepoch() END
        WHERE ${currentEvent} RETURNING failures, available_at AS retryAt, failed_at AS failedAt`)
        .get(error.slice(0, 300), retry ?? 0, Number(retry === undefined), event.id, event.failures, event.generation);
    },
    /** 만료·재시도 대기를 회수하고 수동 우선, 등록 순으로 한 파일을 원자적으로 선점한다. */
    async claim(): Promise<Claim | undefined> {
      // 유휴 워커가 수집 저장과 쓰기 잠금을 두고 경쟁하지 않게 먼저 읽기만 한다.
      const ready = await db.prepare(`SELECT 1 WHERE
        EXISTS (SELECT 1 FROM g2b_attachment_jobs WHERE status = 'pending') OR
        EXISTS (SELECT 1 FROM g2b_attachment_jobs WHERE status = 'retry_wait' AND available_at <= unixepoch()) OR
        EXISTS (SELECT 1 FROM g2b_attachment_jobs WHERE status = 'running' AND expires_at <= unixepoch())`).get();
      if (!ready) return;
      const token = randomUUID();
      return db.transaction(async () => {
        await db.prepare(`UPDATE g2b_attachment_jobs SET status = 'pending'
          WHERE status = 'retry_wait' AND available_at <= unixepoch()`).run();
        await db.prepare(`UPDATE g2b_attachment_jobs
          SET status = CASE WHEN attempts >= 4 THEN 'failed' ELSE 'pending' END,
          token = NULL, expires_at = NULL, error = '첨부 작업 선점 만료'
          WHERE status = 'running' AND expires_at <= unixepoch()`).run();
        const row = await db.prepare(`UPDATE g2b_attachment_jobs
          SET status = 'running', token = ?, expires_at = unixepoch() + 90, attempts = attempts + 1
          WHERE position = (SELECT position FROM g2b_attachment_jobs WHERE status = 'pending'
            ORDER BY priority DESC, position LIMIT 1) RETURNING file, attempts, mode`).get(token);
        if (row) return { file: JSON.parse(String(row.file)), token, attempts: Number(row.attempts), mode: row.mode as Mode };
      });
    },
    /** DB 시각 기준으로 유효한 동일 토큰만 선점을 연장한다. */
    async renew(claim: Claim) {
      return Boolean((await db.prepare(`UPDATE g2b_attachment_jobs SET expires_at = unixepoch() + 90
        WHERE id = ? AND token = ? AND status = 'running' AND expires_at > unixepoch()`)
        .run(claim.file.id, claim.token)).rowsAffected);
    },
    /** 현재 실행권의 결과만 저장하고 PDF 결과와 첨부 완료를 같은 트랜잭션에서 확정한다. */
    async finish(claim: Claim, outcome: Outcome) {
      return db.transaction(async () => {
        const key = [claim.file.id, claim.token] as const;
        const job = await db.prepare(`SELECT mode FROM g2b_attachment_jobs WHERE ${ownsJob}`).get(...key);
        if (!job) return false;
        const promoted = claim.mode === "hash_only" && job.mode === "pdf_extract";
        const success = "hash" in outcome;
        if (success && claim.mode === "pdf_extract" && !outcome.pdf) {
          throw new Error("PDF 추출 작업에 완료 결과가 없습니다.");
        }
        const retry = !success && outcome.retry && claim.attempts < 4;
        let resultId = null;
        if (success && outcome.pdf) {
          const pdf = outcome.pdf;
          let saved = await findPdf.get(outcome.hash, pdf.version);
          if (!saved && "pages" in pdf) {
            saved = await db.prepare(`INSERT INTO g2b_attachment_pdf_results(hash,version,page_count,character_count)
              VALUES (?,?,?,?) RETURNING id`).get(outcome.hash, pdf.version, pdf.pages.length, pdf.characterCount);
            const insertPages = db.prepare(`INSERT INTO g2b_attachment_pdf_pages(result_id,page_number,text)
              SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)`);
            for (const batch of pageBatches(pdf.pages)) await insertPages.run(saved!.id, batch);
          }
          if (!saved) throw new Error("재사용할 PDF 추출 결과가 없습니다.");
          resultId = saved.id;
        }
        const updated = await db.prepare(`UPDATE g2b_attachment_jobs SET status = ?, available_at = unixepoch() + ?,
          hash = COALESCE(?, hash), error = ?, pdf_result_id = ?, token = NULL, expires_at = NULL WHERE ${ownsJob}`)
          .run(promoted ? "pending" : success ? "succeeded" : retry ? "retry_wait" : "failed",
            !promoted && retry ? 30 * 2 ** (claim.attempts - 1) : 0,
            success ? outcome.hash : null, success || promoted ? null : outcome.error, resultId, ...key);
        // 페이지 저장 도중 실행권이 만료되면 결과까지 함께 롤백한다.
        if (!updated.rowsAffected) throw new Error("첨부 작업 실행권이 결과 저장 중 만료되었습니다.");
        return true;
      });
    },
  };
}
