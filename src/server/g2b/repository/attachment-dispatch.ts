import { randomUUID } from "node:crypto";
import { ATTACHMENT_DISPATCH_WINDOW_SECONDS, ATTACHMENT_LEASE_SECONDS } from "@/shared/config/g2b-attachment-worker";
import type { G2bDatabase } from "./database";

// 이벤트와 파일 큐의 준비·지연·만료 인덱스를 사용하며 빈 큐는 읽기에서 종료한다.
const dispatchable = `
  EXISTS (SELECT 1 FROM g2b_attachment_events WHERE failed_at IS NULL AND available_at <= unixepoch()) OR
  EXISTS (SELECT 1 FROM g2b_attachment_jobs WHERE status = 'pending') OR
  EXISTS (SELECT 1 FROM g2b_attachment_jobs WHERE status = 'retry_wait' AND available_at <= unixepoch()) OR
  EXISTS (SELECT 1 FROM g2b_attachment_jobs WHERE status = 'running' AND expires_at <= unixepoch())
`;
const canDispatch = `id = 1 AND expires_at <= unixepoch() AND worker_expires_at <= unixepoch() AND (${dispatchable})`;

/** GitHub 호출 전후에 짧은 예약만 저장하며 네트워크 요청 중 DB 트랜잭션을 유지하지 않는다. */
export function openAttachmentDispatch(db: G2bDatabase) {
  return {
    /** 실행 가능 작업이 있을 때만 다른 워커와 경쟁해 예약 토큰을 발급한다. */
    async reserve() {
      const ready = await db.prepare(`SELECT 1 FROM g2b_attachment_dispatch
        WHERE ${canDispatch}`).get();
      if (!ready) return;
      const token = randomUUID();
      const reserved = await db.prepare(`UPDATE g2b_attachment_dispatch SET token = ?, expires_at = unixepoch() + ?
        WHERE ${canDispatch} RETURNING token`)
        .get(token, ATTACHMENT_DISPATCH_WINDOW_SECONDS);
      if (reserved) return token;
    },
    /** 호출에 실패한 요청의 예약만 해제한다. 접수된 예약은 워커 시작 또는 만료까지 남는다. */
    async releaseReservation(token: string) {
      await db.prepare(`UPDATE g2b_attachment_dispatch SET token = NULL, expires_at = 0
        WHERE id = 1 AND token = ? RETURNING id`).get(token);
    },
    /** 호출 토큰을 소비하고 실행권을 얻는다. 직접 실행은 유효한 예약이 없을 때만 허용한다. */
    async acquireWorker(reservation?: string) {
      const token = randomUUID();
      const key = reservation ?? null;
      const acquired = await db.prepare(`UPDATE g2b_attachment_dispatch SET token = NULL, expires_at = 0,
        worker_token = ?, worker_expires_at = unixepoch() + ?
        WHERE id = 1 AND worker_expires_at <= unixepoch()
          AND ((? IS NULL AND expires_at <= unixepoch()) OR (token = ? AND expires_at > unixepoch()))
        RETURNING id`).get(token, ATTACHMENT_LEASE_SECONDS, key, key);
      if (!acquired) return;
      return {
        token,
        /** 기존 실행권이 유효할 때만 연장하며 만료 후에는 false를 반환한다. */
        async renew() {
          return Boolean(await db.prepare(`UPDATE g2b_attachment_dispatch SET worker_expires_at = unixepoch() + ?
            WHERE id = 1 AND worker_token = ? AND worker_expires_at > unixepoch() RETURNING id`)
            .get(ATTACHMENT_LEASE_SECONDS, token));
        },
        /** 자신의 실행권만 반환해 이미 교체된 워커의 실행을 보호한다. */
        async release() {
          await db.prepare(`UPDATE g2b_attachment_dispatch SET worker_token = NULL, worker_expires_at = 0
            WHERE id = 1 AND worker_token = ? RETURNING id`).get(token);
        },
      };
    },
  };
}
