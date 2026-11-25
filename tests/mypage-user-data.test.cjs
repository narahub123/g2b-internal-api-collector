const assert = require("node:assert/strict");
const { test } = require("node:test");
const { QueryClient, QueryObserver } = require("@tanstack/react-query");
require("../scripts/register-project-typescript.cjs");

/** 실제 쿼리 관측기의 탭 재방문, 변경 무효화 및 계정별 요청을 검증한다. */
test("사용자 정보 탭은 30초 동안 연결 계정과 동의를 재사용한다", async (context) => {
  // 서버 없이 브라우저 요청과 시간 경과를 재현한다.
  const { myPageUserDataOptions, MYPAGE_USER_DATA_KEY } = require("../src/features/service-auth/mypage-user-data-query");
  let now = Date.now();
  let calls = 0;
  let revision = 1;
  context.mock.method(Date, "now", () => now);
  context.mock.method(globalThis, "fetch", async (_url, options) => {
    // 요청 시점의 업무 데이터와 로그인 범위를 응답으로 제공한다.
    calls++;
    return Response.json({ revision, scope: options.headers["x-g2b-mypage-scope"] });
  });
  // 페이지 전환과 같이 동일한 클라이언트에서 관측기를 해제하고 다시 등록한다.
  const client = new QueryClient();
  context.after(() => client.clear());
  /** @param {string} scope 현재 로그인 연결의 범위. @returns 등록 및 해제 가능한 탭 관측기. */
  function visit(scope) {
    // 최초 호출과 재방문이 같은 캐시 정책을 사용한다.
    const observer = new QueryObserver(client, myPageUserDataOptions(scope));
    const leave = observer.subscribe(() => {});
    return { observer, leave };
  }
  // 최초 방문은 업무 API를 한 번 호출하고 유효한 캐시는 다시 읽지 않는다.
  const first = visit("first");
  await client.fetchQuery(myPageUserDataOptions("first"));
  first.leave();
  assert.equal(calls, 1);
  now += 29_999;
  const cached = visit("first");
  assert.equal(cached.observer.getCurrentResult().data.revision, 1);
  assert.equal(calls, 1);
  cached.leave();
  // 30초 후에는 다시 조회하며 변경 무효화도 같은 방식으로 즉시 반영한다.
  now += 2;
  const expired = visit("first");
  await client.fetchQuery(myPageUserDataOptions("first"));
  assert.equal(calls, 2);
  revision = 2;
  await client.invalidateQueries({ queryKey: myPageUserDataOptions("first").queryKey });
  assert.equal(expired.observer.getCurrentResult().data.revision, 2);
  expired.leave();
  // 다른 계정에서는 처음부터 자신의 응답만 사용한다.
  const switched = visit("second");
  assert.equal(switched.observer.getCurrentResult().data, undefined);
  assert.equal((await client.fetchQuery(myPageUserDataOptions("second"))).scope, "second");
  switched.leave();
  // 로그아웃에 사용하는 접두어로 전체 사용자 정보 쿼리를 제거한다.
  client.removeQueries({ queryKey: MYPAGE_USER_DATA_KEY });
  assert.equal(client.getQueryData(myPageUserDataOptions("first").queryKey), undefined);
  assert.equal(client.getQueryData(myPageUserDataOptions("second").queryKey), undefined);
});

/** API는 현재 사용자 범위와 일치할 때만 업무 데이터를 조회한다. */
test("업무 API는 로그아웃과 계정 변경에서 저장소 조회를 차단한다", async (context) => {
  // 요청 경계만 교체해 운영 DB 연결 없이 실제 API 핸들러를 검증한다.
  const paths = [
    "../src/server/auth/current-user.ts",
    "../src/server/auth/repository.ts",
    "../src/server/g2b/repository/index.ts",
    "../app/api/mypage/user-data/route.ts",
  ].map((path) => require.resolve(path));
  const original = paths.map((path) => require.cache[path]);
  context.after(() => {
    // 테스트 전 로드 상태를 복구한다.
    paths.forEach((path, index) => {
      if (original[index]) require.cache[path] = original[index];
      else delete require.cache[path];
    });
  });
  // 현재 역할과 로그인 연결을 명시적으로 제어한다.
  const oauthAccount = { provider: "google", providerUserId: "subject", linkGeneration: "active", email: "qa@example.test" };
  const member = { status: "authenticated", user: { id: "member", oauthAccount } };
  let auth = { status: "unauthenticated" };
  const lookups = [];
  require.cache[paths[0]] = { loaded: true, exports: { verifyCurrentUser: async () => auth } };
  require.cache[paths[1]] = { loaded: true, exports: { openAuthRepository: () => ({
    /** @param {string} id 조회 중인 사용자. @returns 화면용 테스트 연결 목록. */
    async listLinkedAccounts(id) {
      // 실제 요청이 접근한 사용자와 화면 결과를 검증할 수 있도록 기록한다.
      lookups.push(["accounts", id]);
      return [oauthAccount];
    },
    /** @param {string} id 조회 중인 사용자. @returns 비어 있는 테스트 동의 이력. */
    async listLatestConsents(id) {
      // 요청마다 현재 사용자의 이력만 읽는지 기록한다.
      lookups.push(["consents", id]);
      return new Map();
    },
  }) } };
  require.cache[paths[2]] = { loaded: true, exports: { getG2bDatabase: () => ({}) } };
  // 호출자의 이전 범위를 서버가 받은 현재 계정에 대조한다.
  const { GET } = require(paths[3]);
  const { myPageUserDataScope } = require("../src/server/auth/mypage-user-data");
  const request = new Request("http://localhost/api/mypage/user-data", {
    headers: { "x-g2b-mypage-scope": myPageUserDataScope(member) },
  });
  assert.equal((await GET(request)).status, 401);
  auth = { ...member, user: { ...member.user, id: "other-member" } };
  assert.equal((await GET(request)).status, 409);
  assert.deepEqual(lookups, []);
  // 범위가 일치하면 기존 저장소를 사용하고 응답의 HTTP 캐시를 제한한다.
  auth = member;
  const response = await GET(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual((await response.json()).accounts, [
    { provider: "google", email: "qa@example.test", generation: "active", current: true },
  ]);
  assert.deepEqual(lookups, [["accounts", "member"], ["consents", "member"]]);
});
