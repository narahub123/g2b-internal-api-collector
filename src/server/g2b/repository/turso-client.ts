import { createClient } from "@libsql/client";

/**
 * 웹과 워커가 공통으로 사용하는 원격 DB 클라이언트를 생성한다.
 * @throws 서버 환경변수에 URL 또는 토큰이 없을 경우 변수 이름을 담은 오류를 발생시킨다.
 */
export function createTursoClient() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url) throw new Error("TURSO_DATABASE_URL 환경변수가 필요합니다.");
  if (!authToken) throw new Error("TURSO_AUTH_TOKEN 환경변수가 필요합니다.");
  return createClient({ url, authToken });
}
