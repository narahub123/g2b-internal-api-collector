import { randomUUID } from "node:crypto";
import type { G2bDatabase } from "./database";

/** 수집 자료를 다시 읽을 때 사용하는 업무별 식별자다. */
export type AttachmentOwner = { section: "notices" | "order-plans" | "prior-specs"; number: string; revision: string };

/** 공개 목록의 행과 기존 다운로드 경로를 재현하는 데 필요한 정보다. */
export type AttachmentJobFile = {
  id: string; filename: string; owner: AttachmentOwner; source: string;
  group: string; seq: string; path?: string; bytes?: number;
};

type Claim = { file: AttachmentJobFile; token: string; attempts: number };
type Outcome = { hash: string } | { error: string; retry: boolean };

/** 첨부 전용 상태와 실행권을 관리한다. 외부 다운로드 중에는 트랜잭션을 열어 두지 않는다. */
export function openAttachmentQueue(db: G2bDatabase) {
  const insert = db.prepare(`INSERT INTO g2b_attachment_jobs(id,file,priority) VALUES (?,?,?)
    ON CONFLICT(id) DO NOTHING`);
  const read = db.prepare("SELECT status, priority, attempts, hash, error FROM g2b_attachment_jobs WHERE id = ?");
  return {
    /** 수동 요청은 기존 대기 작업을 승격하고 실패한 작업의 시도 횟수를 초기화한다. */
    enqueue(file: AttachmentJobFile, manual: boolean) {
      return db.transaction(async () => {
        await insert.run(file.id, JSON.stringify(file), Number(manual));
        if (manual) {
          await db.prepare(`UPDATE g2b_attachment_jobs SET priority = 1, status = 'pending', available_at = 0,
            attempts = CASE WHEN status = 'failed' THEN 0 ELSE attempts END, error = NULL
            WHERE id = ? AND status IN ('pending', 'retry_wait', 'failed')`).run(file.id);
        }
        return read.get(file.id);
      });
    },
    /** 현재 파일의 상태와 해시를 관리자 화면에 반환한다. */
    status(id: string) { return read.get(id); },
    /** 가장 오래된 미처리 수집 이벤트를 조회한다. */
    async event() {
      return await db.prepare("SELECT id, section, number, revision FROM g2b_attachment_events ORDER BY id LIMIT 1")
        .get() as (AttachmentOwner & { id: number }) | undefined;
    },
    /** 이벤트 삭제와 자동 작업 등록을 같은 트랜잭션으로 확정한다. */
    consume(id: number, files: AttachmentJobFile[]) {
      return db.transaction(async () => {
        if (!(await db.prepare("DELETE FROM g2b_attachment_events WHERE id = ?").run(id)).rowsAffected) return;
        for (const file of files) await insert.run(file.id, JSON.stringify(file), 0);
      });
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
            ORDER BY priority DESC, position LIMIT 1) RETURNING file, attempts`).get(token);
        if (row) return { file: JSON.parse(String(row.file)), token, attempts: Number(row.attempts) };
      });
    },
    /** DB 시각 기준으로 유효한 동일 토큰만 선점을 연장한다. */
    async renew(claim: Claim) {
      return Boolean((await db.prepare(`UPDATE g2b_attachment_jobs SET expires_at = unixepoch() + 90
        WHERE id = ? AND token = ? AND status = 'running' AND expires_at > unixepoch()`)
        .run(claim.file.id, claim.token)).rowsAffected);
    },
    /** 현재 실행권의 결과만 기록하며 일시 실패는 30·60·120초 후 재시도한다. */
    async finish(claim: Claim, outcome: Outcome) {
      const success = "hash" in outcome;
      const retry = !success && outcome.retry && claim.attempts < 4;
      return Boolean((await db.prepare(`UPDATE g2b_attachment_jobs
        SET status = ?, available_at = unixepoch() + ?, hash = ?, error = ?, token = NULL, expires_at = NULL
        WHERE id = ? AND token = ? AND status = 'running' AND expires_at > unixepoch()`)
        .run(success ? "succeeded" : retry ? "retry_wait" : "failed",
          retry ? 30 * 2 ** (claim.attempts - 1) : 0, success ? outcome.hash : null,
          success ? null : outcome.error, claim.file.id, claim.token)).rowsAffected);
    },
  };
}
