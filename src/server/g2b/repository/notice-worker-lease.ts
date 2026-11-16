import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";

// 실행권의 유효 여부는 호스트별 시각 오차를 피하기 위해 DB 시각으로 판단한다.
const leaseSeconds = 90;

/**
 * 현재 실행권이 비어 있거나 만료된 경우에만 공고 워커 실행권을 획득한다.
 * @returns 실행권의 갱신·반환 핸들. 다른 워커가 실행 중이면 null.
 * @throws DB가 조건부 갱신을 처리하지 못한 경우.
 */
export async function acquireNoticeWorkerLease(client: Client) {
  const token = randomUUID();
  const acquired = await client.execute({
    sql: `UPDATE g2b_notice_worker_lease SET token = ?, expires_at = unixepoch() + ?
      WHERE id = 1 AND (token IS NULL OR expires_at <= unixepoch())`,
    args: [token, leaseSeconds],
  });
  if (acquired.rowsAffected !== 1) return null;

  return {
    token,
    /**
     * 만료되지 않은 현재 실행권을 연장한다.
     * @returns 만료 또는 소유권 변경 후에는 false.
     * @throws DB가 갱신을 처리하지 못한 경우.
     */
    async renew() {
      const result = await client.execute({
        sql: `UPDATE g2b_notice_worker_lease SET expires_at = unixepoch() + ?
          WHERE id = 1 AND token = ? AND expires_at > unixepoch()`,
        args: [leaseSeconds, token],
      });
      return result.rowsAffected === 1;
    },
    /**
     * 현재 토큰에 해당하는 실행권을 반환한다.
     * @throws DB가 반환을 처리하지 못하면 실행권은 만료 시 해제된다.
     */
    async release() {
      await client.execute({
        sql: "UPDATE g2b_notice_worker_lease SET token = NULL, expires_at = 0 WHERE id = 1 AND token = ?",
        args: [token],
      });
    },
  };
}
