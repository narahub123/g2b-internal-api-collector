import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { AUTH_SUCCESS_PATH, SESSION_MAX_AGE } from "@/shared/config/auth";
import type { AuthOAuthProfile, AuthSessionUser, AuthUserState, OAuthConnection } from "./types";
import { readSessionCookie, secureSessionCookie, sessionCookieName } from "./session-cookie";

/** 쿠키 검증 실패와 저장소/인증 시스템 장애를 구분하는 보호 요청의 결과. */
export type AuthVerification =
  | { status: "authenticated"; user: AuthSessionUser & AuthOAuthProfile; state: AuthUserState }
  | { status: "unauthenticated" }
  | { status: "error" };

const config = {
  providers: [],
  useSecureCookies: secureSessionCookie,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  jwt: { maxAge: SESSION_MAX_AGE },
  cookies: {
    sessionToken: {
      name: sessionCookieName,
      options: { path: "/", httpOnly: true, sameSite: "lax", secure: secureSessionCookie },
    },
  },
  // 인증 오류 객체에는 콜백 입력과 사용자 정보가 포함될 수 있다.
  logger: { error: (error) => console.error("[인증 라이브러리]", error.name) },
} satisfies NextAuthConfig;

const auth = NextAuth(config);

/**
 * 요청의 세션 쿠키에서 서비스 사용자 정보를 읽는다. 쿠키가 없거나 검증되지 않으면
 * null을 반환한다. DB를 조회하거나 응답 쿠키를 변경하지 않는다.
 * @param requestHeaders 현재 요청 헤더를 직접 제공하는 경우 사용한다.
 * @returns 검증된 세션 프로필 또는 미인증인 경우 null.
 * @throws 세션 쿠키가 있는데 AUTH_SECRET 설정이 누락된 경우.
 */
export async function readSession(requestHeaders?: Headers): Promise<AuthSessionUser | null> {
  // Proxy와 서버가 동일한 쿠키 판독기를 사용한다.
  return readSessionCookie(requestHeaders ?? await headers());
}

/**
 * 쿠키와 최신 DB 상태를 검증한다. 반환된 검증 함수를 한 요청에서 공유하면 사용자 조회를 재사용한다.
 * @param findUserState 내부 ID로 최신 사용자 존재 여부, 역할, 표시 프로필을 읽는 저장소 함수.
 */
export function createAuthVerification(
  findUserState: (id: string, connection: OAuthConnection) => Promise<AuthUserState | undefined>,
  requestHeaders?: Headers,
): () => Promise<AuthVerification> {
  let verification: Promise<AuthVerification> | undefined;

  async function verify(): Promise<AuthVerification> {
    try {
      const user = await readSession(requestHeaders);
      // OAuth 연결을 식별할 수 없는 구형 쿠키는 재로그인을 요구한다.
      const oauthAccount = user?.oauthAccount;
      if (!user || !oauthAccount) return { status: "unauthenticated" };
      // 같은 공급자 계정이 다시 연결됐어도 세대가 다르면 이전 세션은 거절한다.
      const state = await findUserState(user.id, oauthAccount);
      // 쿠키의 인증 계정은 보존하고 표시 프로필에는 DB의 최신 값을 사용한다.
      return state ? {
        status: "authenticated",
        user: { ...user, oauthAccount, nickname: state.nickname, image: state.image },
        state,
      } : { status: "unauthenticated" };
    } catch (error) {
      console.error("[인증 상태 검증]", error instanceof Error ? error.name : "UnknownError");
      return { status: "error" };
    }
  }

  return () => verification ??= verify();
}

/**
 * 서버에서 인증과 DB 저장을 끝낸 서비스 사용자에게 Auth.js 세션을 발급한다.
 * @param user 검증된 내부 사용자 프로필과 동의 판단 결과. 클라이언트 입력을 전달하면 안 된다.
 * @throws 세션을 발급하지 못했거나 성공 경로를 돌려받지 못한 경우.
 */
export async function issueSession(user: AuthSessionUser): Promise<void> {
  // 이 공급자는 호출 범위에만 존재하므로 외부 Auth.js 핸들러에서 호출할 수 없다.
  const issuer = NextAuth({
    ...config,
    providers: [Credentials({ authorize: () => ({ id: user.id }) })],
    callbacks: { jwt: ({ token }) => ({ ...token, serviceUser: user }) },
  });
  const destination = await issuer.signIn("credentials", { redirect: false, redirectTo: AUTH_SUCCESS_PATH });
  if (typeof destination !== "string" || new URL(destination).pathname !== AUTH_SUCCESS_PATH) {
    throw new Error("서비스 세션 발급에 실패했습니다.");
  }
}

/**
 * 최신 사용자 상태를 통과한 세션에만 Auth.js 기본 갱신을 실행한다.
 * 인증 실패 결과는 응답 쿠키를 변경하지 않으며, 갱신 자체의 오류는 호출자에 전달한다.
 * @param verify 현재 요청 범위에서 생성한 검증 함수.
 */
export async function renewSession(verify: () => Promise<AuthVerification>): Promise<AuthVerification> {
  const result = await verify();
  if (result.status !== "authenticated") return result;
  if (!await auth.unstable_update({})) throw new Error("서비스 세션 갱신에 실패했습니다.");
  return result;
}

/**
 * 현재 응답에서 Auth.js 세션 쿠키를 제거한다. DB와 OAuth 제공자 상태는 변경하지 않는다.
 * @throws Auth.js가 로그아웃 쿠키를 설정하지 못한 경우.
 */
export async function endSession(): Promise<void> {
  await auth.signOut({ redirect: false, redirectTo: "/login" });
}
