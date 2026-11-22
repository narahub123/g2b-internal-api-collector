import type { Client } from "@libsql/client";
import type { AuthProfile, AuthUserState } from "./types";

/** 실제 조회와 인덱스 검증에서 동일하게 사용하는 SQL. */
export const authQueries = {
  userState: "SELECT id, role FROM auth_users WHERE id = ?",
  emailCandidates: "SELECT id, nickname FROM auth_users WHERE email = ? COLLATE NOCASE ORDER BY id",
  latestConsent: `
    SELECT id, user_id, item_id, version, agreed, agreed_at, created_at
    FROM auth_consent_records WHERE user_id = ? AND item_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `,
};

/**
 * 기존 libSQL 연결로 인증 조회 저장소를 연다. 연결 수명은 호출자가 관리한다.
 * 각 조회는 DB 오류를 호출자에게 전달해 미등록 사용자와 장애를 구분할 수 있게 한다.
 */
export function openAuthRepository(client: Pick<Client, "execute">) {
  return {
    /** 보호 요청에서는 기본 키로 존재 여부와 최신 역할만 읽는다. */
    async findUserState(id: string): Promise<AuthUserState | undefined> {
      const [row] = (await client.execute({ sql: authQueries.userState, args: [id] })).rows;
      if (!row) return undefined;
      if (row.role !== "USER" && row.role !== "ADMIN") throw new Error("지원하지 않는 사용자 역할");
      return { id: String(row.id), role: row.role };
    },

    /** 검증된 제공자 식별자로 로그인에 필요한 저장 프로필을 찾는다. */
    async findUserByOAuth(provider: string, providerUserId: string): Promise<AuthProfile | undefined> {
      const [row] = (await client.execute({
        sql: `
          SELECT u.id, u.email, u.nickname, u.image FROM auth_oauth_accounts a
          JOIN auth_users u ON u.id = a.user_id WHERE a.provider = ? AND a.provider_user_id = ?
        `,
        args: [provider, providerUserId],
      })).rows;
      if (!row) return undefined;
      return {
        id: String(row.id), email: String(row.email), nickname: String(row.nickname),
        image: typeof row.image === "string" ? row.image : null,
      };
    },

    /** 미연결 OAuth 가입에서 검증된 이메일과 일치하는 선택 후보만 읽는다. */
    async findEmailCandidates(verifiedEmail: string) {
      const { rows } = await client.execute({ sql: authQueries.emailCandidates, args: [verifiedEmail] });
      return rows.map((row) => ({ id: String(row.id), nickname: String(row.nickname) }));
    },

    /** 특정 항목의 최신 기록 하나를 읽어 같은 시각의 기록은 ID 순으로 구분한다. */
    async findLatestConsent(userId: string, itemId: string) {
      const [row] = (await client.execute({ sql: authQueries.latestConsent, args: [userId, itemId] })).rows;
      if (!row) return undefined;
      return {
        id: Number(row.id), userId: String(row.user_id), itemId: String(row.item_id),
        version: String(row.version), agreed: row.agreed === 1,
        agreedAt: row.agreed_at == null ? null : Number(row.agreed_at), createdAt: Number(row.created_at),
      };
    },
  };
}
