/**
 * HTTP 컨텍스트 없는 기존 업무 테스트에 관리자 세션을 제공한다.
 * @param role 테스트가 인증 후 업무 함수에 전달할 역할.
 * @returns 테스트에서 검증과 쿠키 갱신을 교체할 수 있는 모듈 스텁.
 */
function mockBusinessSession(role = "ADMIN") {
  // 업무 가드는 실제 구현을 사용하고 Next.js 요청 경계만 대체한다.
  const filename = require.resolve("../src/server/auth/business-session.ts");
  const session = {
    verifyBusinessUser: async () => ({ status: "authenticated", state: { id: "test-user", role } }),
    renewBusinessSession: async () => {},
  };
  require.cache[filename] = { id: filename, filename, loaded: true, exports: session };
  return session;
}

module.exports = { mockBusinessSession };
