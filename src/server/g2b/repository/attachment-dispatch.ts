import { randomUUID } from "node:crypto";
import { ATTACHMENT_DISPATCH_WINDOW_SECONDS } from "@/shared/config/g2b-attachment-worker";
import type { G2bDatabase } from "./database";

// 이벤트와 파일 큐의 준비·지연·만료 인덱스를 사용하며 빈 큐는 읽기에서 종료한다.
const dispatchable = `
  EXISTS (SELECT 1 FROM g2b_attachment_events WHERE failed_at IS NULL AND available_at <= unixepoch()) OR
  EXISTS (SELECT 1 FROM g2b_attachment_jobs WHERE status = 'pending') OR
  EXISTS (SELECT 1 FROM g2b_attachment_jobs WHERE status = 'retry_wait' AND available_at <= unixepoch()) OR
  EXISTS (SELECT 1 FROM g2b_attachment_jobs WHERE status = 'running' AND expires_at <= unixepoch())
`;

/** GitHub 호출 전후에 짧은 예약만 저장하며 네트워크 요청 중 DB 트랜잭션을 유지하지 않는다. */
export function openAttachmentDispatch(db: G2bDatabase) {
  return {
    /** 실행 가능 작업이 있을 때만 다른 워커와 경쟁해 예약 토큰을 발급한다. */
    async reserve() {
      const ready = await db.prepare(`SELECT 1 FROM g2b_attachment_dispatch
        WHERE id = 1 AND expires_at <= unixepoch() AND (${dispatchable})`).get();
      if (!ready) return;
      const token = randomUUID();
      const reserved = await db.prepare(`UPDATE g2b_attachment_dispatch SET token = ?, expires_at = unixepoch() + ?
        WHERE id = 1 AND expires_at <= unixepoch() AND (${dispatchable}) RETURNING token`)
        .get(token, ATTACHMENT_DISPATCH_WINDOW_SECONDS);
      if (reserved) return token;
    },
    /** 접수 성공 시점부터 중복 호출을 합치고, 실패하면 자기 예약만 해제한다. */
    async finish(token: string, accepted: boolean) {
      await db.prepare(`UPDATE g2b_attachment_dispatch SET token = NULL, expires_at = unixepoch() + ?
        WHERE id = 1 AND token = ? RETURNING id`).get(accepted ? ATTACHMENT_DISPATCH_WINDOW_SECONDS : 0, token);
    },
  };
}
