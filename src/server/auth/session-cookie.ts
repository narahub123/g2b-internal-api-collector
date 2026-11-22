import { getToken } from "next-auth/jwt";
import type { AuthSessionUser } from "./types";

/** 운영에서 HTTPS를 요구하도록 Auth.js 쿠키의 보안 설정을 통일한다. */
export const secureSessionCookie = process.env.NODE_ENV === "production";

/** 발급 모듈과 DB 없는 Proxy가 같이 사용하는 Auth.js 쿠키의 이름. */
export const sessionCookieName = secureSessionCookie ? "__Secure-authjs.session-token" : "authjs.session-token";

/**
 * 서비스 쿠키를 검증해 DB 조회 전의 인증 자료만 읽는다.
 * @param requestHeaders 쿠키를 가져올 요청 헤더.
 * @returns 검증된 세션 프로필 또는 쿠키가 없거나 유효하지 않으면 null.
 * @throws 쿠키가 있으나 서버 비밀이 설정되지 않은 경우.
 */
export async function readSessionCookie(requestHeaders: Headers): Promise<AuthSessionUser | null> {
  const cookie = requestHeaders.get("cookie");
  // Auth.js에 쿠키만 전달해 Bearer 헤더를 인증 근거로 삼지 않는다.
  const cookieHeaders = new Headers(cookie ? { cookie } : undefined);
  const raw = await getToken({ req: { headers: cookieHeaders }, cookieName: sessionCookieName, raw: true });
  if (!raw) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret?.trim()) throw new Error("AUTH_SECRET 환경변수가 필요합니다.");
  // JWT 유효 기간과 서비스에서 사용하는 프로필의 구조를 확인한다.
  const token = await getToken({ req: { headers: cookieHeaders }, cookieName: sessionCookieName, secret });
  if (!token || typeof token.exp !== "number" || token.exp <= Date.now() / 1000) return null;
  const user = token.serviceUser as AuthSessionUser | undefined;
  if (!user || typeof user.id !== "string" || !user.id || typeof user.email !== "string"
    || typeof user.nickname !== "string" || (user.image !== null && typeof user.image !== "string")
    || typeof user.consentRenewal?.required !== "boolean" || typeof user.consentRenewal?.overdue !== "boolean") {
    return null;
  }
  return user;
}
