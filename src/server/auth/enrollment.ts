import { randomUUID } from "node:crypto";
import type { ConsentPolicy } from "@/shared/config/auth";
import type { G2bDatabase } from "@/server/g2b/repository/database";
import { openAuthRepository } from "./repository";
import type { AuthProfile, AuthSessionUser } from "./types";

/**
 * 브라우저가 제출한 정책 버전과 항목별 선택 상태.
 * id는 문서 식별자, version은 제출 버전, agreed는 체크 여부다.
 */
export type SignupConsent = { id: string; version: string; agreed: boolean };

/** 제공자 검증을 끝낸 식별자와 신규 계정에 사용할 수 있는 프로필. */
export type OAuthIdentity = {
  // OAuth 연결에 사용하는 공급자 이름.
  provider: string;
  // 이메일과 독립적으로 계정을 확인하는 공급자 고유 ID.
  providerUserId: string;
  // 공급자가 확인한 이메일이며 제공되지 않으면 null.
  email: string | null;
  // 가입 시 저장할 이름이며 제공되지 않으면 null.
  nickname: string | null;
  // 표시용 이미지 주소이며 제공되지 않으면 null.
  image: string | null;
};

/** 동시 처리나 기존 계정 유무를 포함해 서버가 결정한 가입·로그인 결과. */
export type EnrollmentResult =
  // 이미 가입했거나 이번에 가입을 저장한 사용자의 프로필.
  | { status: "existing" | "registered"; user: AuthProfile }
  // 회원 또는 추가 확인 자료가 없어 세션을 발급할 수 없는 이유.
  | { status: "signup-required" | "incomplete-profile" | "link-required" };

/**
 * 현재 시행 중인 정책만 가입 화면과 서버 검증의 기준으로 사용한다.
 * @param policies 시행일을 확인할 문서 목록.
 * @param now 기준 시각을 나타내는 Unix 밀리초.
 * @returns 기준 시각에 시행 중인 정책.
 */
export function activeConsentPolicies(policies: readonly ConsentPolicy[], now = Date.now()) {
  // 시행일에 도달한 정책만 가입 화면과 서버 검증에 사용한다.
  return policies.filter(({ effectiveAt }) => Date.parse(effectiveAt) <= now);
}

/**
 * 필수 동의가 충족되며 항목과 버전이 최신 정책과 일대일로 일치하는지 확인한다.
 * @param policies 현재 시행 중인 정책의 항목, 버전과 필수 조건.
 * @param submitted 가입 폼에서 제출한 항목별 버전과 선택.
 * @returns 항목 누락 또는 중복, 버전 불일치, 필수 미동의가 없으면 true.
 */
export function validateSignupConsent(
  policies: readonly Pick<ConsentPolicy, "id" | "version" | "required">[],
  submitted: readonly SignupConsent[],
): boolean {
  // 모든 항목이 해당 버전으로 한 번씩 제출되었는지 확인한다.
  return submitted.length === policies.length && policies.every(({ id, version, required }) =>
    submitted.filter((item) => item.id === id && item.version === version && (!required || item.agreed)).length === 1);
}

/**
 * 인증된 OAuth 연결을 먼저 확인한다. 신규 가입에서는 쓰기 트랜잭션 안에서
 * 동일 연결과 이메일 후보를 재검사한 뒤 사용자, OAuth 연결, 동의 이력을 한 번에 저장한다.
 * @param consent 현재 정책과 대조를 마친 가입 동의. 로그인에서는 빈 배열을 전달한다.
 * @throws 조회나 저장에 실패하면 롤백한 뒤 저장소 오류를 전달한다.
 * @param database SQL 실행과 트랜잭션을 제공하는 저장소.
 * @param purpose 미등록 계정에서 로그인과 가입을 구분하는 목적.
 * @param identity 공급자 검증을 거친 고유 키와 프로필.
 * @returns 기존 또는 신규 회원의 프로필이나 가입·확인이 필요한 상태.
 */
export async function resolveEnrollment(
  database: Pick<G2bDatabase, "execute" | "transaction">,
  purpose: "login" | "signup",
  identity: OAuthIdentity,
  consent: readonly SignupConsent[],
): Promise<EnrollmentResult> {
  // 연결 조회용 고유 키와 신규 회원에 사용할 프로필을 가져온다.
  const { provider, providerUserId, email, nickname, image } = identity;
  // 가입 조회를 지정된 DB 실행기에 묶는다.
  const repository = openAuthRepository(database);
  // 이메일에 앞서 공급자와 고유 ID로 등록 여부를 확인한다.
  const existing = await repository.findUserByOAuth(provider, providerUserId);
  // 이미 연결된 계정은 저장된 정보를 그대로 사용한다.
  if (existing) return { status: "existing", user: existing };
  // 미등록 로그인은 이메일 후보를 조회하지 않고 가입 안내를 반환한다.
  if (purpose === "login") return { status: "signup-required" };
  // 신규 가입에서 사용할 확인된 이메일이 없으면 중단한다.
  if (!email) return { status: "incomplete-profile" };

  // 가입 경쟁으로 인한 DB 오류와 실제 저장 실패를 구분한다.
  try {
    /**
     * 같은 연결과 이메일 후보 조회, 사용자 및 동의 저장을 한 트랜잭션에서 수행한다.
     * @returns 추가 쓰기가 필요 없는 상태 또는 커밋할 신규 회원.
     */
    return await database.transaction(async (): Promise<EnrollmentResult> => {
      // 쓰기 권한을 얻은 뒤 같은 OAuth 연결을 다시 조회한다.
      const linked = await repository.findUserByOAuth(provider, providerUserId);
      // 경쟁 요청이 먼저 가입했으면 기존 회원으로 처리한다.
      if (linked) return { status: "existing", user: linked };
      // 이메일 후보가 있으면 추가 인증에 앞서 계정과 세션을 만들지 않는다.
      if ((await repository.findEmailCandidates(email)).length) return { status: "link-required" };
      // 신규 가입에 필요한 표시 이름이 없으면 저장을 중단한다.
      if (!nickname) return { status: "incomplete-profile" };

      // 기존 계정과 독립적인 내부 사용자 ID를 발급한다.
      const user = { id: randomUUID(), email, nickname, image };
      // 같은 가입의 동의 기록에 동일한 저장 시각을 사용한다.
      const recordedAt = Date.now();
      // 기본 역할이 부여되는 내부 사용자 행을 먼저 저장한다.
      await database.execute({
        sql: "INSERT INTO auth_users (id, email, nickname, image) VALUES (?, ?, ?, ?)",
        args: [user.id, email, nickname, image],
      });
      // 공급자와 고유 사용자 ID를 새 내부 계정에 연결한다.
      await database.execute({
        sql: "INSERT INTO auth_oauth_accounts (provider, provider_user_id, user_id) VALUES (?, ?, ?)",
        args: [provider, providerUserId, user.id],
      });
      // 동의 항목별로 선택 결과와 버전을 별도 이력으로 남긴다.
      for (const { id, version, agreed } of consent) {
        // 동의한 항목에만 동의 시각을 기록한다.
        await database.execute({
          sql: "INSERT INTO auth_consent_records (user_id, item_id, version, agreed, agreed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          args: [user.id, id, version, Number(agreed), agreed ? recordedAt : null, recordedAt],
        });
      }
      // 커밋 시 세션 발급에 사용할 신규 프로필을 반환한다.
      return { status: "registered", user };
    });
  } catch (error) {
    // 저장 경쟁을 잃은 경우에만 같은 OAuth 고유 키의 기존 가입자로 처리한다.
    if (typeof error === "object" && error !== null && "code" in error
      && /^(SQLITE_CONSTRAINT|SQLITE_BUSY)/.test(String(error.code))) {
      // 제약 또는 잠금 충돌 시 동일 OAuth 연결이 저장되었는지 확인한다.
      const linked = await repository.findUserByOAuth(provider, providerUserId);
      // 다른 요청이 같은 OAuth 연결을 먼저 저장한 경우에만 기존 회원을 반환한다.
      if (linked) return { status: "existing", user: linked };
    }
    // 경쟁 요청으로 해결되지 않은 저장 오류는 호출자에게 전달한다.
    throw error;
  }
}

/**
 * 가입 트랜잭션이 끝난 결과에서만 세션을 발급한다. 발급 오류는 가입 데이터에 손대지 않고
 * 재로그인 안내 코드로 반환하며, 계정 연결 대기나 미가입 로그인에서는 발급을 호출하지 않는다.
 * @param result 계산된 가입 결과와 해당하는 경우의 저장 프로필.
 * @param issue 검증된 서비스 사용자의 세션 쿠키 발급 함수.
 * @returns 인증 성공, 원래의 가입 안내 또는 신규·기존 회원별 발급 실패 코드.
 */
export async function startEnrollmentSession(
  result: EnrollmentResult,
  issue: (user: AuthSessionUser) => Promise<void>,
) {
  // 내부 사용자가 확정되지 않으면 원래의 상태를 전달한다.
  if (!("user" in result)) return result.status;
  try {
    // 실제 동의 갱신 판단은 계정 연결 단계에서 연결한다.
    await issue({ ...result.user, consentRenewal: { required: false, overdue: false } });
    // 쿠키 발급 성공 후 공통 이동 경로를 선택할 수 있게 한다.
    return "authenticated";
  // 발급 실패 시 가입 기록은 보존하고 안내 코드를 결정한다.
  } catch (error) {
    // 민감한 프로필과 예외 내용 대신 오류 유형을 기록한다.
    console.error("[서비스 세션 발급]", error instanceof Error ? error.name : "UnknownError");
    // 가입을 완료한 회원과 기존 회원에게 알려줄 실패 원인을 구분한다.
    return result.status === "registered" ? "registered-session-failed" : "session-failed";
  }
}
