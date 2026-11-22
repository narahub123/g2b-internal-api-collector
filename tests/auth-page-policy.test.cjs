const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../scripts/register-project-typescript.cjs");

/** 갱신 성공과 이동 주소가 없는 HTTP 거절을 구분하는지 확인한다. */
test("세션 갱신의 HTTP 거절을 성공으로 처리하지 않는다", async (context) => {
  const { renewPageSession } = require("../src/features/service-auth/renew-page-session");
  // 동일한 본문을 반환해도 HTTP 상태에 따라 결과가 달라져야 한다.
  const fetchMock = context.mock.method(globalThis, "fetch", async () => Response.json({ destination: null }));
  assert.equal(await renewPageSession("/mypage"), null);
  fetchMock.mock.mockImplementation(async () => Response.json({ destination: null }, { status: 403 }));
  await assert.rejects(renewPageSession("/mypage"), /403/);
  // 기존 로그인·권한 부족·시스템 오류는 안전한 서비스 내부 경로를 계속 사용한다.
  for (const [status, destination] of [[401, "/login"], [403, "/auth/return?from=%2Fadmin"], [503, "/auth/error"]]) {
    fetchMock.mock.mockImplementation(async () => Response.json({ destination }, { status }));
    assert.equal(await renewPageSession("/mypage"), destination);
  }
  // 안전하지 않은 이동 주소는 정상 갱신이나 이동으로 처리하지 않는다.
  fetchMock.mock.mockImplementation(async () => Response.json({ destination: "//external.test" }, { status: 403 }));
  await assert.rejects(renewPageSession("/mypage"), /403/);
});

/** 같은 경로 정책이 공개, 게스트, 일반 회원 및 관리자의 접근 결과를 계산하는지 확인한다. */
test("페이지 정책은 정확한 경로 경계와 세 역할의 접근을 판정한다", () => {
  const { canAccessPage } = require("../src/shared/config/page-access");
  // 비로그인, 일반 회원, 관리자 순으로 각 경로의 접근 결과를 비교한다.
  for (const [path, expected] of [
    ["/", [true, true, true]], ["/login", [true, false, false]], ["/signup/", [true, false, false]],
    ["/mypage", [false, true, true]], ["/g2b/notices/one/000", [false, true, true]],
    ["/admin", [false, false, true]], ["/admin/g2b/notice-queue", [false, false, true]],
    ["/administrator", [false, true, true]], ["/login/other", [false, true, true]],
    ["/auth/google/callback", [true, true, true]], ["/auth/unknown/callback", [false, true, true]],
  ]) {
    assert.deepEqual([null, "USER", "ADMIN"].map((role) => canAccessPage(path, role)), expected, path);
  }
});

/** 접근할 수 있는 내부 화면만 복귀 대상으로 사용하고 검색 조건을 보존하는지 확인한다. */
test("복귀는 외부 주소와 현재 경로, 인증 경로 및 권한을 잃은 화면을 건너뛴다", () => {
  const { findReturnDestination } = require("../src/shared/config/page-access");
  const allowed = "/g2b/notices/one/000?from=%2F%3Fsection%3Dnotices";
  const history = [
    "//external.test", "/%2Fexternal.test", "/admin/../mypage", "/\\external.test",
    "/login", "/api/notices", "/admin/g2b", allowed,
  ];
  assert.equal(findReturnDestination(history, "/admin/g2b?tab=1", "USER"), allowed);
  assert.equal(findReturnDestination(["/admin/g2b", "/admin"], "/admin/g2b?tab=1", "ADMIN"), "/admin");
  assert.equal(findReturnDestination(["/admin/g2b", "/no-such-route", "/auth/error", "/auth/return", "/g2b/notices"], "/admin", "USER"), "/mypage");
  assert.equal(findReturnDestination(["/?section=notices&page=4"], "/admin", "USER"), "/?section=notices&page=4");
});

/** 브라우저 잠금을 지원하지 않아도 먼저 요청한 갱신이 끝난 뒤 로그아웃 처리가 시작되는지 확인한다. */
test("갱신 중 로그아웃하면 쿠키 쓰기 순서를 유지한다", async () => {
  const { withSessionCookieWrite } = require("../src/features/service-auth/session-writes");
  const order = [];
  // 갱신 응답이 아직 도착하지 않은 상황을 만든다.
  const refreshResponse = Promise.withResolvers();
  const refresh = withSessionCookieWrite(async () => {
    order.push("refresh");
    await refreshResponse.promise;
  });
  // 초기 쿠키 응답이 진행 중일 때 동일한 쿠키를 삭제하려고 시도한다.
  const logout = withSessionCookieWrite(async () => { order.push("logout"); });
  await Promise.resolve();
  assert.deepEqual(order, ["refresh"]);
  // 성공 결과와 함께 로그아웃 쓰기가 다음 순서로 실행된다.
  refreshResponse.resolve();
  await Promise.all([refresh, logout]);
  assert.deepEqual(order, ["refresh", "logout"]);
});
