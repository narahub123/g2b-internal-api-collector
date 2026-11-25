import type { Client, Row } from "@libsql/client";
import type { AuthOAuthProfile, AuthUserState, OAuthConnection } from "./types";

/** 실제 조회와 인덱스 검증에서 동일하게 사용하는 SQL. */
export const authQueries = {
  userState: "SELECT id, role, nickname, image FROM auth_users WHERE id = ?",
  // 보호 요청에서 OAuth 복합 키와 내부 사용자 기본 키를 한 문장으로 검증한다.
  sessionUserState: `SELECT u.id, u.role, u.nickname, u.image FROM auth_oauth_accounts a
    JOIN auth_users u ON u.id = a.user_id
    WHERE a.provider = ? AND a.provider_user_id = ? AND a.link_generation = ? AND a.user_id = ?`,
  // 기존 복합 키로 같은 내부 사용자와 연결 세대가 유지되는지 확인한다.
  currentOAuthConnection: `SELECT 1 FROM auth_oauth_accounts
    WHERE provider = ? AND provider_user_id = ? AND link_generation = ? AND user_id = ?`,
  // 사용자별 연결 인덱스로 목록 범위를 제한한다.
  linkedAccounts: "SELECT provider, provider_user_id, email, link_generation FROM auth_oauth_accounts WHERE user_id = ?",
  // 실행 계정이 여전히 같은 사용자에 연결돼 있고 대상과 다를 때만 해제한다.
  unlinkAccount: `DELETE FROM auth_oauth_accounts AS target WHERE target.user_id = ? AND target.link_generation = ?
    AND EXISTS (SELECT 1 FROM auth_oauth_accounts AS actor
      WHERE actor.provider = ? AND actor.provider_user_id = ? AND actor.link_generation = ?
        AND actor.user_id = target.user_id AND actor.link_generation <> target.link_generation)`,
  // 신규 연결은 내부 사용자에만 추가하고 기존 OAuth 고유 연결은 변경하지 않는다.
  insertLinkedAccount: `INSERT INTO auth_oauth_accounts (provider, provider_user_id, user_id, email, link_generation)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT (provider, provider_user_id) DO NOTHING`,
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
  // 철회도 새 행에 기록해 과거 동의 내용을 유지한다.
  appendConsent: `INSERT INTO auth_consent_records
    (user_id, item_id, version, agreed, agreed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
};

/**
 * DB의 정수 선택과 날짜를 화면 및 정책에 사용할 동의 기록으로 변환한다.
 * @param row 최신 동의 인덱스에서 가져온 한 행.
 * @returns 최신 버전과 동의·철회 상태, 사건 시각을 담은 기록.
 */
function decodeConsent(row: Row) {
  // 철회나 미동의에는 표시할 동의 시각이 없다.
  return {
    id: Number(row.id), userId: String(row.user_id), itemId: String(row.item_id),
    version: String(row.version), agreed: row.agreed === 1,
    agreedAt: row.agreed_at == null ? null : Number(row.agreed_at), createdAt: Number(row.created_at),
  };
}

/**
 * 여러 정책의 최신 이력을 한 번의 호출에서 읽는 SQL을 생성한다.
 * @param count 서버 정책 목록에서 조회할 항목 수. 1 이상이다.
 * @returns 항목마다 최신 이력 한 건만 인덱스로 읽어 합치는 SQL.
 */
export function latestConsentListSql(count: number) {
  // 항목별 ORDER BY 및 LIMIT을 개별 서브쿼리에 유지한다.
  return Array<string>(count).fill(`SELECT * FROM (${authQueries.latestConsent})`).join(" UNION ALL ");
}

/**
 * 기존 libSQL 연결로 인증 조회 저장소를 연다. 연결 수명은 호출자가 관리한다.
 * 각 조회는 DB 오류를 호출자에게 전달해 미등록 사용자와 장애를 구분할 수 있게 한다.
 */
export function openAuthRepository(client: Pick<Client, "execute">) {
  return {
    /**
     * 보호 요청의 기본 키 조회를 사용해 최신 역할과 표시 프로필을 함께 읽는다.
     * @param id 세션에서 검증한 내부 사용자 ID.
     * @param connection 보호 요청에서 확인할 공급자 계정과 연결 세대. 내부 관리 조회에서는 생략한다.
     * @returns 유효한 사용자 상태 또는 사용자나 지정된 연결이 없으면 undefined.
     * @throws 조회가 실패하거나 저장된 역할이 지원되지 않으면 오류를 전달한다.
     */
    async findUserState(id: string, connection?: OAuthConnection): Promise<AuthUserState | undefined> {
      // 보호 요청은 연결 유효성까지 한 번에 읽고 내부 작업은 사용자만 읽는다.
      const [row] = (await client.execute(connection
        ? { sql: authQueries.sessionUserState, args: [connection.provider, connection.providerUserId, connection.linkGeneration, id] }
        : { sql: authQueries.userState, args: [id] })).rows;
      // 삭제된 사용자의 세션에는 유효한 상태를 제공하지 않는다.
      if (!row) return undefined;
      // 정의된 역할만 보호 요청에 사용할 수 있다.
      if (row.role !== "USER" && row.role !== "ADMIN") throw new Error("지원하지 않는 사용자 역할");
      // 최신 닉네임과 이미지 경로를 권한 확인 결과에 담는다.
      return { id: String(row.id), role: row.role, nickname: String(row.nickname), image: typeof row.image === "string" ? row.image : null };
    },

    /**
     * 현재 프로필에 연결된 OAuth 계정 목록을 읽는다.
     * @param userId 인증된 내부 사용자 ID.
     * @returns 공급자, 계정 키, 확인된 이메일과 해제 대상 식별용 세대.
     * @throws DB 목록 조회 오류를 전달한다.
     */
    async listLinkedAccounts(userId: string) {
      // 전체 계정이 아니라 현재 사용자의 연결만 읽는다.
      const { rows } = await client.execute({ sql: authQueries.linkedAccounts, args: [userId] });
      // 이메일이 아직 확인되지 않은 기존 행은 null로 유지한다.
      return rows.map((row) => ({ provider: String(row.provider), providerUserId: String(row.provider_user_id),
        linkGeneration: String(row.link_generation), email: typeof row.email === "string" ? row.email : null }));
    },

    /**
     * 로그인에 사용한 연결을 남긴 상태에서 다른 연결 한 건을 원자적으로 해제한다.
     * @param userId 로그인한 내부 사용자 ID.
     * @param actor 현재 로그인에 사용한 계정과 연결 세대.
     * @param generation 확인 Dialog에서 선택한 대상 연결 세대.
     * @returns 해제 성공이면 true. 소유권, 연결 세대 또는 다른 연결 유지 조건이 맞지 않으면 false.
     * @throws DB 쓰기 오류를 전달한다.
     */
    async unlinkAccount(userId: string, actor: OAuthConnection, generation: string) {
      // 실행 계정이 남아 있어야 하므로 현재 또는 마지막 계정을 삭제할 수 없다.
      const result = await client.execute({ sql: authQueries.unlinkAccount,
        args: [userId, generation, actor.provider, actor.providerUserId, actor.linkGeneration] });
      // 경쟁 요청이 이미 대상이나 실행 계정을 제거했으면 해제 실패로 전달한다.
      return result.rowsAffected === 1;
    },

    /**
     * 공급자 계정이 지정된 내부 사용자와 연결 세대에 여전히 속하는지 확인한다.
     * @param userId 검증할 내부 사용자.
     * @param connection 인증에서 확인한 공급자 고유 계정과 세대.
     * @returns 같은 연결 행이 현재 존재하면 true.
     * @throws DB 조회 오류를 전달한다.
     */
    async isOAuthConnectionCurrent(userId: string, connection: OAuthConnection) {
      // 다른 사용자에게 재연결됐거나 세대가 바뀐 경우도 해제된 인증으로 본다.
      const { rows } = await client.execute({ sql: authQueries.currentOAuthConnection,
        args: [connection.provider, connection.providerUserId, connection.linkGeneration, userId] });
      return rows.length === 1;
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
        const result = await client.execute({
          sql: authQueries.oauthEmailUpdate,
          args: [verifiedEmail, account.provider, account.providerUserId, account.linkGeneration, account.email],
        });
        // 동시 이메일 갱신과 연결 해제·재연결을 구분해 유효한 연결만 세션 발급으로 넘긴다.
        if (result.rowsAffected === 0 && !await this.isOAuthConnectionCurrent(profile.id, account)) {
          throw new Error("OAuth 계정 연결이 변경되었습니다.");
        }
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
      return decodeConsent(row);
    },

    /**
     * 화면에 해당하는 현재 정책들의 최신 이력을 한 번의 DB 요청으로 읽는다.
     * @param userId 인증된 내부 사용자 식별자.
     * @param itemIds 시행 중인 정책의 식별자 목록.
     * @returns 조회된 항목만 들어 있는 최신 이력 맵.
     * @throws 저장소 오류가 있으면 호출자에게 전달한다.
     */
    async listLatestConsents(userId: string, itemIds: readonly string[]) {
      // 활성 문서가 없다면 연결을 사용하지 않는다.
      const latest = new Map<string, ReturnType<typeof decodeConsent>>();
      if (!itemIds.length) return latest;
      // 바인딩으로 사용자와 항목을 지정해 이력 전체 대신 최신 행만 읽는다.
      const { rows } = await client.execute({
        sql: latestConsentListSql(itemIds.length), args: itemIds.flatMap((itemId) => [userId, itemId]),
      });
      for (const row of rows) {
        // 문서 표시 순서는 조회 순서 대신 정책 목록에서 결정한다.
        const consent = decodeConsent(row);
        latest.set(consent.itemId, consent);
      }
      return latest;
    },

    /**
     * 확인한 현재 버전의 동의 또는 철회 이력을 추가한다.
     * @param userId 동의를 제출한 내부 사용자 ID.
     * @param item 검증한 항목, 문서 버전 및 선택 상태.
     * @param agreedAt 동의한 시각이며 철회는 null.
     * @param createdAt 최신 기록의 순서를 유지할 이벤트 시각.
     * @throws 저장에 실패하면 진행 중인 트랜잭션을 되돌릴 수 있게 오류를 전달한다.
     */
    async appendConsent(userId: string, item: { id: string; version: string; agreed: boolean },
      agreedAt: number | null, createdAt: number) {
      // 과거 이력을 수정하지 않고 새 사건을 한 행에 남긴다.
      await client.execute({ sql: authQueries.appendConsent,
        args: [userId, item.id, item.version, Number(item.agreed), agreedAt, createdAt] });
    },
  };
}
