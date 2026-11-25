import type { Client } from "@libsql/client";
import type { AuthOAuthProfile, AuthUserState } from "./types";

/** 실제 조회와 인덱스 검증에서 동일하게 사용하는 SQL. */
export const authQueries = {
  userState: "SELECT id, role, nickname, image FROM auth_users WHERE id = ?",
  // 이름만 바꾸면 변경된 이미지와 관계없이 현재 경로를 유지한다.
  updateNickname: "UPDATE auth_users SET nickname = ? WHERE id = ?",
  // 이미지 교체는 업로드가 시작될 때 읽은 기존 경로가 여전히 맞아야 한다.
  replaceProfileImage: "UPDATE auth_users SET nickname = ?, image = ? WHERE id = ? AND image IS ?",
  emailCandidates: "SELECT id, nickname FROM auth_users WHERE email = ? COLLATE NOCASE ORDER BY id",
  // 공급자 복합 기본 키로 연결을 찾고 내부 사용자 기본 키로 표시 프로필을 읽는다.
  oauthProfile: `SELECT u.id, u.email, u.nickname, u.image, a.email AS oauth_email, a.link_generation
    FROM auth_oauth_accounts a JOIN auth_users u ON u.id = a.user_id
    WHERE a.provider = ? AND a.provider_user_id = ?`,
  // 조회한 연결과 이메일이 여전히 일치할 때만 공급자가 확인한 이메일을 저장한다.
  oauthEmailUpdate: `UPDATE auth_oauth_accounts SET email = ?
    WHERE provider = ? AND provider_user_id = ? AND link_generation = ? AND email IS ?`,
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
    /**
     * 보호 요청의 기본 키 조회를 사용해 최신 역할과 표시 프로필을 함께 읽는다.
     * @param id 세션에서 검증한 내부 사용자 ID.
     * @returns 사용자 상태 또는 내부 사용자가 없으면 undefined.
     * @throws 조회가 실패하거나 저장된 역할이 지원되지 않으면 오류를 전달한다.
     */
    async findUserState(id: string): Promise<AuthUserState | undefined> {
      // 보호 요청당 같은 기본 키 조회 한 번으로 접근 여부와 프로필을 결정한다.
      const [row] = (await client.execute({ sql: authQueries.userState, args: [id] })).rows;
      // 삭제된 사용자의 세션에는 유효한 상태를 제공하지 않는다.
      if (!row) return undefined;
      // 정의된 역할만 보호 요청에 사용할 수 있다.
      if (row.role !== "USER" && row.role !== "ADMIN") throw new Error("지원하지 않는 사용자 역할");
      // 최신 닉네임과 이미지 경로를 권한 확인 결과에 담는다.
      return { id: String(row.id), role: row.role, nickname: String(row.nickname), image: typeof row.image === "string" ? row.image : null };
    },

    /**
     * 내부 사용자의 이름을 저장하고, 이미지가 있으면 기존 경로가 일치할 때 교체한다.
     * @param id 쓰기 권한을 확인한 사용자 ID.
     * @param nickname 검증한 닉네임.
     * @param image 교체 전후 경로. 생략하면 닉네임만 수정한다.
     * @returns 한 사용자만 변경했으면 true. 삭제됐거나 교체가 충돌하면 false.
     * @throws 저장소 실패가 발생하면 오류를 전달한다.
     */
    async updateProfile(id: string, nickname: string, image?: { previous: string | null; next: string }) {
      // 파일이 있을 때만 조건부 경로 갱신을 실행한다.
      const result = await client.execute(image
        ? { sql: authQueries.replaceProfileImage, args: [nickname, image.next, id, image.previous] }
        : { sql: authQueries.updateNickname, args: [nickname, id] });
      // 쓰기가 확정된 경우에만 호출자가 기존 파일을 정리할 수 있다.
      return result.rowsAffected === 1;
    },

    /**
     * 검증된 공급자 식별자로 계정 연결과 내부 프로필을 함께 읽는다.
     * @param provider 인증을 완료한 OAuth 공급자.
     * @param providerUserId 공급자가 확인한 계정 고유 키.
     * @returns 연결된 내부 프로필과 저장된 계정 정보, 미연결 상태이면 undefined.
     * @throws 조회 실패 시 저장소 오류를 전달한다.
     */
    async findUserByOAuth(provider: string, providerUserId: string): Promise<AuthOAuthProfile | undefined> {
      // 공급자 복합 기본 키로 로그인 계정 한 건을 읽는다.
      const [row] = (await client.execute({
        sql: authQueries.oauthProfile,
        args: [provider, providerUserId],
      })).rows;
      // 연결이 없다면 가입 또는 연결 안내는 호출자가 결정한다.
      if (!row) return undefined;
      // 내부 이메일과 해당 OAuth 연결의 이메일을 별도로 반환한다.
      return {
        id: String(row.id), email: String(row.email), nickname: String(row.nickname),
        image: typeof row.image === "string" ? row.image : null,
        oauthAccount: {
          provider, providerUserId, linkGeneration: String(row.link_generation),
          email: typeof row.oauth_email === "string" ? row.oauth_email : null,
        },
      };
    },

    /**
     * 변경된 인증 이메일만 계정 연결에 반영하고 현재 인증에 맞는 프로필을 구성한다.
     * @param profile 인증된 계정 키로 조회한 내부 프로필과 계정 연결.
     * @param verifiedEmail 이번 OAuth 인증에서 확인한 이메일. 미제공이면 null.
     * @returns 이번 인증에서 확인한 이메일을 포함한 세션용 프로필.
     * @throws 이메일 저장이 실패하면 오류를 호출자에게 전달한다.
     */
    async confirmOAuthEmail(profile: AuthOAuthProfile, verifiedEmail: string | null): Promise<AuthOAuthProfile> {
      // 기존 계정 정보는 이메일 비교와 쓰기 충돌 방지에 사용한다.
      const account = profile.oauthAccount;
      // 미제공 또는 동일 이메일이면 DB 쓰기를 생략한다.
      if (verifiedEmail !== null && verifiedEmail !== account.email) {
        // 동시에 변경된 이메일이나 재연결된 계정은 이전 조회 결과로 덮어쓰지 않는다.
        await client.execute({
          sql: authQueries.oauthEmailUpdate,
          args: [verifiedEmail, account.provider, account.providerUserId, account.linkGeneration, account.email],
        });
      }
      // 세션에는 DB에 과거 저장된 값 대신 이번 인증에서 확인된 값을 전달한다.
      return { ...profile, oauthAccount: { ...account, email: verifiedEmail } };
    },

    /** 미연결 OAuth 가입에서 검증된 이메일과 일치하는 선택 후보만 읽는다. */
    async findEmailCandidates(verifiedEmail: string) {
      const { rows } = await client.execute({ sql: authQueries.emailCandidates, args: [verifiedEmail] });
      return rows.map((row) => ({ id: String(row.id), nickname: String(row.nickname) }));
    },

    /**
     * 선택 대상이 현재도 확인된 이메일을 사용하는지 내부 사용자 키로 검증한다.
     * @param id 추가 인증으로 확인할 계정의 내부 ID.
     * @param verifiedEmail 최초 가입 인증에서 검증한 이메일.
     * @returns 계정이 존재하고 후보 조회와 같은 비교 규칙으로 이메일이 일치하면 true.
     * @throws 저장소의 조회 오류를 전달한다.
     */
    async isEmailCandidate(id: string, verifiedEmail: string): Promise<boolean> {
      // 내부 키로 한 행만 검색하고 이메일 비교는 후보 목록과 동일하게 처리한다.
      const { rows } = await client.execute({
        sql: "SELECT 1 FROM auth_users WHERE id = ? AND email = ? COLLATE NOCASE",
        args: [id, verifiedEmail],
      });
      return rows.length > 0;
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
