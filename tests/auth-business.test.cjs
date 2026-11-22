const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../scripts/register-project-typescript.cjs");
// 요청의 최신 역할을 바꿔 같은 브라우저에 대한 권한 변경을 모의한다.
const session = require("./mock-business-session.cjs").mockBusinessSession();

/** 실제 공통 가드가 실패한 요청의 업무 호출을 중단하는지 검증한다. */
test("업무 API는 최신 역할을 확인하고 거절된 요청에서는 업무 함수를 호출하지 않는다", async () => {
  const { withBusinessAccess } = require("../src/server/auth/business-access");
  const request = new Request("http://localhost/api/work");
  let calls = 0;
  const work = async () => { calls++; return Response.json({ ok: true }); };
  const execute = (auth, role) => withBusinessAccess(role, work, async () => auth)(request);
  const user = { status: "authenticated", state: { id: "internal", role: "USER" } };
  assert.equal((await execute({ status: "unauthenticated" }, "ADMIN")).status, 401);
  assert.equal((await execute(user, "ADMIN")).status, 403);
  assert.equal((await execute({ status: "error" }, "USER")).status, 503);
  assert.equal(calls, 0);
  assert.equal((await execute(user, "USER")).status, 200);
  assert.equal(calls, 1);
});

/** 실제 관리자 진입점에서 권한 변경 이후 요청의 매개변수와 업무 처리가 차단되는지 확인한다. */
test("재수집 API는 역할 해제와 사용자 삭제를 다음 요청부터 적용한다", async () => {
  // 관리자에게는 기존 업무 입력 검증을 허용하되 회원과 삭제된 사용자는 거기까지 도달하면 안 된다.
  let auth = { status: "authenticated", state: { id: "test-user", role: "ADMIN" } };
  session.verifyBusinessUser = async () => auth;
  const { POST } = require("../app/api/prior-specs/[number]/route");
  const url = "http://localhost/api/prior-specs/example";
  let reached = 0;
  const context = { get params() { reached++; return Promise.resolve({ number: "" }); } };
  assert.equal((await POST(new Request(url, { method: "POST" }), context)).status, 400);
  auth.state.role = "USER";
  const denied = await POST(new Request(url, { method: "POST", headers: { "x-g2b-business-page": "/admin/g2b" } }), context);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("x-g2b-business-auth"), "forbidden");
  assert.equal((await denied.json()).destination, "/auth/return?from=%2Fadmin%2Fg2b&reason=business");
  const allowedPage = await POST(new Request(url, { method: "POST", headers: { "x-g2b-business-page": "/mypage" } }), context);
  assert.equal((await allowedPage.json()).destination, undefined);
  auth = { status: "unauthenticated" };
  const deleted = await POST(new Request(url, { method: "POST" }), context);
  assert.equal(deleted.status, 401);
  assert.equal(reached, 1);
});
