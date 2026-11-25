import { randomUUID } from "node:crypto";
import type { G2bDatabase } from "@/server/g2b/repository/database";
import type { OAuthIdentity } from "./enrollment";
import { authQueries, openAuthRepository } from "./repository";
import type { OAuthConnection } from "./types";

/**
 * 현재 연결의 소유권을 다시 확인하고 OAuth로 검증한 계정만 사용자에게 추가한다.
 * @param database 검증과 저장을 한 쓰기 트랜잭션으로 실행하는 DB.
 * @param userId 추가를 시작한 내부 사용자 ID.
 * @param actor 추가를 시작한 로그인 계정의 연결 키.
 * @param identity 별도 OAuth 인증으로 확인한 대상 계정과 이메일.
 * @returns added, already-linked, conflict 또는 현재 연결이 사라졌으면 expired.
 * @throws 조회나 저장이 실패하면 변경을 롤백한다.
 */
export async function addLinkedAccount(
  database: Pick<G2bDatabase, "execute" | "transaction">, userId: string, actor: OAuthConnection, identity: OAuthIdentity,
) {
  // 쓰기 권한을 얻은 뒤 소유권 확인과 추가를 직렬화한다.
  return database.transaction(async () => {
    // 공급자 인증이 진행되는 동안 연결이 해제된 세션은 변경을 실행할 수 없다.
    const repository = openAuthRepository(database);
    if (!await repository.isOAuthConnectionCurrent(userId, actor)) return "expired";
    // 이메일은 연결 판단에 쓰지 않고 OAuth가 확인한 주소만 새 행에 기록한다.
    const result = await database.execute({ sql: authQueries.insertLinkedAccount,
      args: [identity.provider, identity.providerUserId, userId, identity.email, randomUUID()] });
    if (result.rowsAffected === 1) return "added";
    // 이미 등록된 계정의 소유자를 확인하고 같은 사용자일 때만 이메일을 갱신한다.
    const existing = await repository.findUserByOAuth(identity.provider, identity.providerUserId);
    if (existing?.id !== userId) return "conflict";
    await repository.confirmOAuthEmail(existing, identity.email);
    return "already-linked";
  });
}
