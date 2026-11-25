import { createHash } from "node:crypto";
import type { AuthVerification } from "./session";

/**
 * 검증된 사용자와 로그인 연결에 해당하는 탭 데이터의 캐시 범위를 만든다.
 * @param auth 현재 요청에서 확인한 로그인 사용자.
 * @returns 내부 식별자와 연결 세대를 직접 노출하지 않는 비교값.
 */
export function myPageUserDataScope(auth: Extract<AuthVerification, { status: "authenticated" }>) {
  // 같은 사람이라도 현재 로그인 표시가 달라지는 연결이면 별도로 보관한다.
  return createHash("sha256")
    .update(JSON.stringify([auth.user.id, auth.user.oauthAccount.linkGeneration]))
    .digest("hex");
}
