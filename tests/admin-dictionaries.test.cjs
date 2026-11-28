// 검색과 필터는 파일이나 원본 요청 없이 저장 행으로 검증한다.
const assert = require("node:assert/strict");
const test = require("node:test");
require("../scripts/register-project-typescript.cjs");
const { dictionaryPage } = require("../src/_pages/admin/manage/dictionary-list.ts");

/** 업종 필터 조합과 중복 행, 전체 분류 선택지를 검증한다. */
function verifyIndustry() {
  // 같은 업종이 중복된 자료와 다른 분류를 함께 배치한다.
  const match = { industryCode: "0017", industryName: "시설 관리", categoryCode: "01", categoryName: "용역", active: "Y" };
  const disabled = { ...match, active: "N" };
  const unrelated = { ...match, industryCode: "1001", categoryCode: "02", categoryName: "물품" };
  const rows = [match, disabled, match, unrelated];
  const result = dictionaryPage("industry-law", rows, {
    field: "industryCode", q: " 0017 ", categoryCode: ["01", "invalid"], active: "Y", page: "9",
  });
  // 모든 조건을 통과한 중복 행이 원래 순서로 남는다.
  assert.deepEqual(result.rows, [match, match]);
  assert.deepEqual(result.values, { categoryCode: ["01"], active: ["Y"] });
  assert.deepEqual(result.filters[0].options.map(({ value }) => value), ["01", "02"]);
  assert.equal(result.page, 1);
  assert.equal(dictionaryPage("industry-law", rows, { field: "industryName", q: "관리", active: ["Y", "N"] }).total, 4);
}

/** 법정동 명칭, 폐지 여부, 최대 페이지 보정을 검증한다. */
function verifyDistricts() {
  // 두 페이지에 걸쳐 폐지 행이 남고 현존 행은 선택에서 제외된다.
  const rows = Array.from({ length: 52 }, (_, index) => ({
    code: String(index).padStart(10, "0"), name: "서울특별시", status: index === 0 ? "존재" : "폐지",
  }));
  const result = dictionaryPage("legal-districts", rows, { field: "name", q: "서울", status: "폐지", page: "200" });
  assert.equal(result.total, 51);
  assert.equal(result.totalPages, 2);
  assert.equal(result.page, 2);
  assert.deepEqual(result.rows, [rows[51]]);
  assert.equal(dictionaryPage("legal-districts", rows, { field: "unknown", q: "0000000000", page: "abc" }).total, 1);
  assert.equal(dictionaryPage("legal-districts", rows, { field: "name", q: "없음" }).total, 0);
}

/** 관리자 액션은 권한 확인 후 큐에만 접수하고 실패한 호출은 작업을 보존한다. */
async function verifyActions() {
  // 격리된 실제 DB와 모의 인증·호출을 조합한다.
  const { createClient } = require("@libsql/client");
  const { G2bDatabase } = require("../src/server/g2b/repository/database.ts");
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations.ts");
  const queuePath = require.resolve("../src/server/collections/dictionary-queue.ts");
  const dispatchPath = require.resolve("../src/server/collections/dictionary-dispatch.ts");
  const authPath = require.resolve("../src/server/auth/business-access.ts");
  const cachePath = require.resolve("next/cache");
  const cardsPath = require.resolve("../src/_pages/admin/manage/dictionary-server.ts");
  const { openDictionaryQueue } = require(queuePath);
  const client = createClient({ url: ":memory:" });
  await migrateG2bDatabase(client);
  const queue = openDictionaryQueue(new G2bDatabase(client));
  const originals = new Map();
  let denied = true;
  let dispatchCalls = 0;
  let refreshes = 0;
  const revalidated = [];

  /**
   * 새 액션이 사용할 모의 서버 의존성을 설치한다.
   * @param {string} path 의존성 경로.
   * @param {object} exports 모의 의존성.
   */
  function mock(path, exports) {
    originals.set(path, require.cache[path]);
    require.cache[path] = { exports };
  }

  mock(authPath, {
    checkAdminAction: async () => denied ? { error: "권한 없음" } : null,
    withBusinessAccess: (role, handler) => {
      assert.equal(role, "ADMIN");
      return (request) => denied ? new Response(null, { status: 401 }) : handler(request);
    },
  });
  mock(queuePath, { getDictionaryQueue: () => queue });
  mock(dispatchPath, { dispatchDictionaries: async () => {
    dispatchCalls++;
    if (dispatchCalls === 1) throw new Error("모의 워커 호출 실패");
  } });
  mock(cachePath, { revalidatePath: (path) => revalidated.push(path) });
  mock(cardsPath, {
    ...require(cardsPath),
    getDictionaryCards: async (keys) => {
      refreshes++;
      assert.deepEqual(keys, ["industry-law"]);
      return [{ id: "industry-law", details: { total: 1 } }];
    },
  });
  try {
    // 권한 거절과 잘못된 식별자는 큐 생성이나 설정 변경보다 먼저 끝난다.
    const { collectDictionaries, saveDictionarySchedule } = require("../src/_pages/admin/manage/collect-dictionaries.ts");
    const { GET } = require("../app/api/dictionaries/queue/status/route.ts");
    const { POST } = require("../app/api/dictionaries/queue/tick/route.ts");
    assert.deepEqual(await collectDictionaries("all"), { error: "권한 없음", ids: [] });
    assert.deepEqual(await saveDictionarySchedule("industry-law", true, 7), { error: "권한 없음" });
    assert.equal((await GET(new Request("https://example.test/?id=1"))).status, 401);
    denied = false;
    assert.ok((await collectDictionaries("prototype")).error);
    assert.ok((await saveDictionarySchedule("industry-law", true, 1.5)).error);
    assert.equal(dispatchCalls, 0);
    const accepted = await collectDictionaries("all");
    assert.ok(accepted.warning);
    assert.equal(accepted.ids.length, 2);
    assert.deepEqual((await collectDictionaries("industry-law")).ids, [accepted.ids[0]]);
    assert.deepEqual((await queue.jobs(accepted.ids)).map(({ status }) => status), ["pending", "pending"]);
    assert.deepEqual(await saveDictionarySchedule("industry-law", true, 9), {});
    assert.equal((await queue.settings()).find(({ key }) => key === "industry-law").days, 9);
    assert.deepEqual(revalidated, ["/admin/manage/dictionaries"]);
    // 상태 조회는 대기 중 Blob을 읽지 않고 부분 성공 종료 후 성공 카드만 갱신한다.
    const statusRequest = new Request("https://example.test/?" + accepted.ids.map((id) => "id=" + id).join("&"));
    assert.equal((await GET(statusRequest).then((response) => response.json())).pending, true);
    assert.equal(refreshes, 0);
    const industry = await queue.claim();
    await queue.finish(industry.id, industry.token, "updated");
    const district = await queue.claim();
    await queue.finish(district.id, district.token, { retry: true });
    const completed = await GET(statusRequest).then((response) => response.json());
    assert.equal(completed.pending, false);
    assert.deepEqual(completed.jobs.map(({ status }) => status), ["succeeded", "failed"]);
    assert.equal(refreshes, 1);

    // 외부 호출은 토큰이 일치해야 일정과 워커 호출에 접근한다.
    const previousToken = process.env.NOTICE_CRON_TOKEN;
    process.env.NOTICE_CRON_TOKEN = "test-cron-token";
    try {
      assert.equal((await POST(new Request("https://example.test/"))).status, 401);
      assert.equal((await POST(new Request("https://example.test/", {
        headers: { Authorization: "Bearer test-cron-token" },
      }))).status, 204);
    } finally {
      if (previousToken === undefined) delete process.env.NOTICE_CRON_TOKEN;
      else process.env.NOTICE_CRON_TOKEN = previousToken;
    }
  } finally {
    // 다른 테스트가 실제 모듈을 불러올 수 있게 복구한다.
    for (const [path, original] of originals) {
      if (original) require.cache[path] = original;
      else delete require.cache[path];
    }
    client.close();
  }
}

// 두 상세 목록과 수집 진입점을 독립적으로 검증한다.
test("업종 검색과 다중 필터가 원본 행을 보존한다", verifyIndustry);
test("법정동 폐지 필터와 목록 페이지 범위를 적용한다", verifyDistricts);
test("사전 수집 액션은 권한과 중복 접수 및 설정을 처리한다", verifyActions);
