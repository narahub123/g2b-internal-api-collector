import { verifyCurrentUser } from "./current-user";
import { renewSession, type AuthVerification } from "./session";

/** 실제 요청의 서비스 세션과 최신 내부 사용자 역할을 확인한다. */
export const verifyBusinessUser = verifyCurrentUser;

/**
 * 권한 검증에 사용한 결과를 다시 조회하지 않고 세션을 갱신한다.
 * @param auth 업무를 수행할 권한이 확인된 사용자 상태.
 * @throws Auth.js가 인증 쿠키를 갱신하지 못한 경우.
 */
export async function renewBusinessSession(auth: Extract<AuthVerification, { status: "authenticated" }>) {
  await renewSession(async () => auth);
}
