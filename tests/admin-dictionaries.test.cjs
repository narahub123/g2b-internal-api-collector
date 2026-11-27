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

/** 권한 검사, 전체 수집 부분 실패, 경로 갱신과 잠금 충돌을 검증한다. */
async function verifyActions() {
  // 실제 권한 요청과 원본 네트워크 대신 검증 가능한 응답을 사용한다.
  const authModule = require.resolve("../src/server/auth/business-access.ts");
  const nextCache = require.resolve("next/cache");
  const authCache = require.cache[authModule];
  const cacheExports = require.cache[nextCache];
  const revalidated = [];
  const calls = [];
  let denied = true;
  require.cache[authModule] = { exports: { checkAdminAction: async () => denied ? { error: "권한 없음" } : null } };
  require.cache[nextCache] = { exports: { revalidatePath: (path) => revalidated.push(path) } };
  const { dictionaryServer } = require("../src/_pages/admin/manage/dictionary-server.ts");
  const industry = dictionaryServer["industry-law"].collect;
  const districts = dictionaryServer["legal-districts"].collect;
  try {
    // 업종이 잠금으로 중단되어도 법정동은 정상적으로 이어서 실행된다.
    dictionaryServer["industry-law"].collect = async () => {
      calls.push("industry-law");
      throw new Error("같은 출력 경로에 수집 잠금이 있습니다: 테스트");
    };
    dictionaryServer["legal-districts"].collect = async () => {
      calls.push("legal-districts");
      return { status: "updated" };
    };
    const { collectDictionaries } = require("../src/_pages/admin/manage/collect-dictionaries.ts");
    assert.deepEqual(await collectDictionaries("all"), { error: "권한 없음", results: [] });
    denied = false;
    assert.ok((await collectDictionaries("prototype")).error);
    assert.deepEqual(calls, []);
    assert.deepEqual((await collectDictionaries("all")).results, [
      { id: "industry-law", status: "busy" }, { id: "legal-districts", status: "updated" },
    ]);
    assert.deepEqual(calls, ["industry-law", "legal-districts"]);
    assert.deepEqual(revalidated, ["/admin/manage", "/admin/manage/dictionaries", "/admin/manage/dictionaries/legal-districts"]);
    // 잠금이 풀린 다음에는 개별 수집을 다시 실행할 수 있다.
    dictionaryServer["industry-law"].collect = async () => ({ status: "unchanged" });
    assert.deepEqual((await collectDictionaries("industry-law")).results, [{ id: "industry-law", status: "unchanged" }]);
  } finally {
    // 모의 함수를 원상 복구해 테스트 간 간섭을 피한다.
    dictionaryServer["industry-law"].collect = industry;
    dictionaryServer["legal-districts"].collect = districts;
    if (authCache) require.cache[authModule] = authCache;
    else delete require.cache[authModule];
    if (cacheExports) require.cache[nextCache] = cacheExports;
    else delete require.cache[nextCache];
  }
}

// 두 상세 목록과 수집 진입점을 독립적으로 검증한다.
test("업종 검색과 다중 필터가 원본 행을 보존한다", verifyIndustry);
test("법정동 폐지 필터와 목록 페이지 범위를 적용한다", verifyDistricts);
test("사전 수집 액션은 권한과 사전별 결과를 처리한다", verifyActions);
