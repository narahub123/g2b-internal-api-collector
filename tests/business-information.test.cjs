// 격리 DB와 문서 픽스처를 실제 수집 모듈에 연결하는 테스트 의존성이다.
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
require("../scripts/register-project-typescript.cjs");

/** 수동 갱신의 권한과 실행권, 결과별 데이터 반영을 검증한다. */
test("전체 갱신은 성공 항목까지 재수집하고 정상 빈 응답과 실패를 구분한다", async (context) => {
  // 실제 스키마의 공유 사업자에 초기 성공 결과를 준비한다.
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { openBusinessInformation } = require("../src/server/g2b/repository/business-information");
  const { openBusinessRegistration } = require("../src/features/business-information/server/registration");
  const client = createClient({ url: "file::memory:" });
  context.after(() => client.close());
  await migrateG2bDatabase(client);
  await client.execute("INSERT INTO auth_users(id,email,nickname) VALUES ('a','a@example.test','a'),('b','b@example.test','b')");
  const db = new G2bDatabase(client);
  const store = openBusinessInformation(db);
  let mode = "initial";
  const calls = [];
  const entered = Promise.withResolvers();
  const responseGate = Promise.withResolvers();
  const service = openBusinessRegistration(db, async (kind) => {
    // 첫 갱신을 지연해 다른 요청이 같은 실행권을 인수하는지 확인한다.
    calls.push(kind);
    if (mode === "refresh") {
      entered.resolve();
      await responseGate.promise;
      if (kind === "industry") throw new Error("업종 갱신 실패");
      if (kind === "basic") return [{ corpNm: "변경 업체" }];
      return [];
    }
    return kind === "basic" ? [{ corpNm: "기존 업체" }] : [{ bizno: "2208162517" }];
  });
  const id = await service.register("a", "2208162517");
  await service.register("b", "2208162517");
  calls.length = 0;
  // 등록되지 않은 사용자와 번호 불일치는 모두 수집 전에 거부한다.
  await assert.rejects(service.refresh("other", id, "2208162517"), /등록/);
  await assert.rejects(service.refresh("a", id, "6168122531"), /등록/);
  assert.equal(calls.length, 0);
  mode = "refresh";
  const refresh = service.refresh("a", id, "2208162517");
  await entered.promise;
  assert.deepEqual(await service.refresh("b", id, "2208162517"), { status: "busy" });
  // 전체 갱신이 7종 실행권을 보유하는 동안 실패 재시도는 새 요청을 만들지 않는다.
  await service.retry("b", id);
  assert.equal(calls.length, 7);
  responseGate.resolve();
  assert.deepEqual(await refresh, { status: "finished", saved: 6, total: 7 });
  // 다른 등록 사용자가 최신 기본정보, 실패한 업종의 기존 행과 정상 빈 물품을 조회한다.
  assert.equal((await store.listForUser("b"))[0].name, "변경 업체");
  const { sections } = await store.detailForUser("b", id);
  assert.deepEqual(sections.industry, { status: "failed", items: [{ bizno: "2208162517" }] });
  assert.deepEqual(sections.product, { status: "succeeded", items: [] });
  mode = "initial";
  calls.length = 0;
  const retryStarted = Promise.withResolvers();
  const retryGate = Promise.withResolvers();
  const delayedRetry = openBusinessRegistration(db, async (kind) => {
    calls.push(kind);
    retryStarted.resolve();
    await retryGate.promise;
    return [];
  });
  const retry = delayedRetry.retry("b", id);
  await retryStarted.promise;
  // 반대로 재시도 한 종만 실행 중이어도 전체 갱신은 나머지 유형을 일부 확보하지 않는다.
  assert.deepEqual(await service.refresh("a", id, "2208162517"), { status: "busy" });
  assert.deepEqual(calls, ["industry"]);
  retryGate.resolve();
  await retry;

  // 마지막 등록 관계가 삭제되면 진행 중인 갱신은 어떤 결과도 반영하지 못한다.
  const deletionGate = Promise.withResolvers();
  const refreshStarted = Promise.withResolvers();
  const delayed = openBusinessRegistration(db, async () => {
    refreshStarted.resolve();
    await deletionGate.promise;
    return [{ corpNm: "삭제 뒤 도착한 결과" }];
  });
  const pending = delayed.refresh("a", id, "2208162517");
  await refreshStarted.promise;
  assert.equal(await store.removeRegistration("a", id, "2208162517"), true);
  assert.equal(await store.removeRegistration("b", id, "2208162517"), true);
  deletionGate.resolve();
  assert.deepEqual(await pending, { status: "finished", saved: 0, total: 7 });
  assert.equal((await client.execute("SELECT COUNT(*) AS count FROM business_basic")).rows[0].count, 0);
});

/** 삭제가 공유 관계, 수집 실행권, 재사용 ID 및 트랜잭션에 미치는 영향을 확인한다. */
test("사업자 등록 관계를 해제하고 마지막 연결에서만 수집 데이터를 삭제한다", async (context) => {
  // 기존 마이그레이션에 두 사용자와 7종의 저장 결과 및 실행 상태를 준비한다.
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { openBusinessInformation } = require("../src/server/g2b/repository/business-information");
  const client = createClient({ url: "file::memory:" });
  context.after(() => client.close());
  await migrateG2bDatabase(client);
  await client.executeMultiple(`
    INSERT INTO auth_users(id,email,nickname) VALUES ('a','a@example.test','a'),('b','b@example.test','b');
    INSERT INTO businesses VALUES (1,'2208162517');
    INSERT INTO user_businesses VALUES ('a',1),('b',1);
    INSERT INTO business_basic VALUES (1,'{"corpNm":"공유 업체"}');
    INSERT INTO business_industry VALUES (1,'{}');
    INSERT INTO business_product VALUES (1,'{}');
    INSERT INTO business_sanction VALUES (1,'{}');
    INSERT INTO business_smpp VALUES (1,'directProduction','{}'),(1,'women','{}'),(1,'disabled','{}');
  `);
  const db = new G2bDatabase(client);
  const store = openBusinessInformation(db);
  // 실행 중인 수집과 저장된 오류가 있는 상태에서 첫 사용자의 연결만 지운다.
  const now = Date.now();
  await store.claim(1, "old", now, now + 60_000, "20261126");
  await store.fail(1, "sanction", "old", { name: "Error", message: "수집 실패" });
  assert.equal(await store.removeRegistration("other", 1, "2208162517"), false);
  assert.equal(await store.removeRegistration("a", 1, "2208162517"), true);
  assert.equal(await store.removeRegistration("a", 1, "2208162517"), false);
  assert.equal(await store.detailForUser("a", 1), undefined);
  assert.equal((await store.detailForUser("b", 1)).sections.women.items.length, 1);
  assert.equal(await store.complete(1, "industry", "old", [{ indstrytyCd: "0015" }]), "saved");

  // 사업자 삭제가 실패하면 먼저 삭제한 마지막 연결도 롤백한다.
  await client.executeMultiple("CREATE TRIGGER reject_delete BEFORE DELETE ON businesses BEGIN SELECT RAISE(ABORT,'삭제 오류'); END;");
  await assert.rejects(store.removeRegistration("b", 1, "2208162517"), /삭제 오류/);
  assert.equal((await store.detailForUser("b", 1)).sections.sanction.status, "failed");
  await client.execute("DROP TRIGGER reject_delete");
  assert.equal(await store.removeRegistration("b", 1, "2208162517"), true);
  // 마지막 삭제는 모든 업무 행, 진단과 사용자 연결을 정리한다.
  for (const table of ["businesses", "user_businesses", "business_basic", "business_industry", "business_product", "business_sanction", "business_smpp", "business_collection"]) {
    assert.equal((await client.execute(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count, 0);
  }
  assert.equal(await store.complete(1, "basic", "old", [{ corpNm: "지연 응답" }]), "lease-lost");

  // 기존 ID가 다른 사업자에 재사용된 뒤에는 이전 확인으로 삭제하거나 저장할 수 없다.
  const replacement = await db.transaction(async () => store.register("b", "6168122531"));
  assert.equal(replacement, 1);
  await store.claim(1, "new", now, now + 60_000, "20261126");
  assert.equal(await store.removeRegistration("b", 1, "2208162517"), false);
  assert.equal(await store.complete(1, "basic", "old", [{ corpNm: "지연 응답" }]), "lease-lost");
  assert.equal((await store.detailForUser("b", 1)).number, "6168122531");

  // 새 연결과 기존 연결 삭제를 동시에 실행해도 새 사용자의 공유 데이터가 유지된다.
  await Promise.all([
    db.transaction(async () => store.register("a", "6168122531")),
    store.removeRegistration("b", 1, "6168122531"),
  ]);
  assert.equal((await store.detailForUser("a", 1)).sections.basic.status, "running");

  // 마지막 삭제가 먼저 커밋된 경우 재등록은 새 수집 상태로 시작한다.
  const [removed, registered] = await Promise.all([
    store.removeRegistration("a", 1, "6168122531"),
    db.transaction(async () => store.register("b", "6168122531")),
  ]);
  assert.equal(removed, true);
  assert.equal((await store.detailForUser("b", registered)).sections.basic.status, "incomplete");
  assert.equal(await store.complete(registered, "basic", "new", [{ corpNm: "지연 응답" }]), "lease-lost");
});

/** 실제 마이그레이션에서 공유 등록, 부분 실패, 재시도와 조회 계획을 검증한다. */
test("사업자 등록과 7종 수집 결과를 사용자 간에 공유한다", async (context) => {
  // 운영 연결 없이 실제 스키마와 등록 서비스를 준비한다.
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { openBusinessRegistration } = require("../src/features/business-information/server/registration");
  const client = createClient({ url: "file::memory:" });
  context.after(() => client.close());
  await migrateG2bDatabase(client);
  await client.execute("INSERT INTO auth_users(id,email,nickname) VALUES ('a','a@example.test','a'),('b','b@example.test','b')");

  // 업종만 첫 시도에서 실패하도록 응답하고 나머지 호출을 추적한다.
  const calls = [];
  let fail = true;
  const service = openBusinessRegistration(new G2bDatabase(client), async (kind) => {
    calls.push(kind);
    if (kind === "industry" && fail) throw new Error("응답 실패");
    return kind === "basic" ? [{ corpNm: "공유 업체" }, { corpNm: "공유 업체" }] : [];
  });

  // 잘못된 번호를 거절하고 두 사용자의 동시 등록을 같은 사업자에 연결한다.
  await assert.rejects(service.register("a", "123-45-67890"), /사업자등록번호/);
  const [first, second] = await Promise.all([
    service.register("a", "220-81-62517"),
    service.register("b", "2208162517"),
  ]);
  assert.equal(first, second);
  assert.equal(calls.length, 7);

  // 실패 상태와 정상 빈 결과를 DB에서 구분하고 중복 업무 항목을 제거했는지 확인한다.
  /**
   * 격리 DB에서 검증 쿼리의 행을 읽는다.
   * @param {string} sql 검증에 사용할 SQL.
   * @param {Array} args SQL에 바인딩할 인자.
   * @returns {Promise<Array>} 결과 행.
   */
  const read = async (sql, args = []) => (await client.execute({ sql, args })).rows;
  assert.deepEqual((await read("SELECT status FROM business_collection WHERE kind = 'industry'"))[0].status, "failed");
  assert.equal(JSON.parse((await read("SELECT diagnostics FROM business_collection WHERE kind = 'industry'"))[0].diagnostics).name, "Error");
  assert.equal((await read("SELECT COUNT(*) AS count FROM business_collection WHERE status = 'succeeded'"))[0].count, 6);
  assert.equal((await read("SELECT COUNT(*) AS count FROM business_basic"))[0].count, 1);

  // 실패 유형만 다시 호출하고 성공 시 진단을 비운다.
  fail = false;
  await service.retry("b", first);
  assert.deepEqual(calls.slice(7), ["industry"]);
  assert.equal((await read("SELECT error FROM business_collection WHERE kind = 'industry'"))[0].error, null);
  await assert.rejects(service.retry("unlinked", first), /등록/);

  // 선택한 사업자의 데이터에 복합 기본 키 범위 검색을 사용하는지 확인한다.
  for (const table of ["business_basic", "business_industry", "business_product", "business_sanction", "business_smpp", "business_collection"]) {
    const plan = await read(`EXPLAIN QUERY PLAN SELECT * FROM ${table} WHERE business_id = ?`, [first]);
    assert.match(plan[0].detail, /SEARCH .*\(business_id=\?\)/);
  }
});

/** 응답 문서의 실제 JSON과 XML로 필드 보존과 요청 규약을 검증한다. */
test("실제 응답 픽스처 7종에서 문서상 업무 값만 보존한다", async (context) => {
  // 환경과 HTTP를 대체하여 운영 키나 DB 없이 API 요청을 확인한다.
  const { BUSINESS_APIS } = require("../src/entities/business/model/business-apis");
  const { collectBusinessApi } = require("../src/features/business-information/server/collect-business-api");
  const ppsKey = "sample/pps+=";
  const smppKey = "sample/smpp+=";
  const previous = { PPS_USER_INFO_SERVICE_KEY: process.env.PPS_USER_INFO_SERVICE_KEY, SMPP_CERT_INFO_SERVICE_KEY: process.env.SMPP_CERT_INFO_SERVICE_KEY };
  process.env.PPS_USER_INFO_SERVICE_KEY = encodeURIComponent(ppsKey);
  process.env.SMPP_CERT_INFO_SERVICE_KEY = smppKey;
  context.after(() => {
    // 테스트 후 외부 키 설정을 원래 상태로 복원한다.
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  // 응답 파일과 요청이 일치하도록 호출 유형마다 하나의 예제 본문을 제공한다.
  let body;
  let request;
  context.mock.method(globalThis, "fetch", async (url) => {
    // 페이지 간에 바뀌는 URL 객체를 스냅샷으로 저장한다.
    request = new URL(url);
    return new Response(body);
  });
  const counts = { basic: 1, industry: 4, product: 5, sanction: 0, directProduction: 2, women: 1, disabled: 1 };
  const referenceDate = "20261126";
  for (const [kind, api] of Object.entries(BUSINESS_APIS)) {
    // 각 오퍼레이션의 실제 문서 응답을 그대로 파서 입력으로 사용한다.
    const dir = join(__dirname, "../docs/api-responses", api.certificate ? "smpp" : "pps");
    const file = readdirSync(dir).find((name) => name.includes(`(${api.operation})`));
    body = readFileSync(join(dir, file), "utf8").match(/```(?:json|xml)\r?\n([\s\S]+?)```/)[1];
    const number = api.certificate ? "2208162517" : JSON.parse(body).response.body.items?.[0]?.bizno ?? "6168122531";
    const rows = await collectBusinessApi(kind, number, referenceDate);
    // 업무 필드만 반환하고 원래 요청에 키와 조회 조건을 넣었는지 확인한다.
    assert.equal(rows.length, counts[kind]);
    assert.ok(rows.every((item) => Object.keys(item).every((key) => api.fields.includes(key))));
    assert.equal(request.pathname.split("/").at(-1), api.operation);
    assert.equal(request.searchParams.get(api.certificate || kind === "sanction" ? "ServiceKey" : "serviceKey"), api.certificate ? smppKey : ppsKey);
    assert.equal(request.searchParams.get(api.certificate ? "bsnmNo" : "bizno"), number);
    assert.equal(request.searchParams.get("stdrDate"), api.certificate ? referenceDate : null);
    assert.equal(request.searchParams.get("inqryDiv"), api.certificate ? null : kind === "basic" ? "3" : "1");
    if (kind === "basic") assert.equal(rows[0].hmpgAdrs, "");
    if (kind === "industry") assert.ok(rows.some((item) => item.indstrytyCd === "0015" && item.indstrytyNm === ""));
    if (kind === "directProduction") assert.ok(rows.every((item) => !Object.hasOwn(item, "essntlPartclrMatter")));
  }
});

/** 두 번째 페이지의 실패와 쓰기 실패가 이전 결과에 영향을 주지 않는지 검증한다. */
test("페이지 오류와 저장 오류를 개별 처리하고 자격 증명을 마스킹한다", async (context) => {
  // 이전 저장본과 동시에 독립 수집이 가능한 격리 연결을 준비한다.
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { openBusinessRegistration } = require("../src/features/business-information/server/registration");
  const { collectBusinessApi } = require("../src/features/business-information/server/collect-business-api");
  const rawKey = "private+key/with=escaping";
  const encodedKey = encodeURIComponent(rawKey);
  const previous = process.env.PPS_USER_INFO_SERVICE_KEY;
  process.env.PPS_USER_INFO_SERVICE_KEY = encodedKey;
  context.after(() => {
    // 프로세스에서 테스트용 자격 증명을 원래 설정으로 되돌린다.
    if (previous === undefined) delete process.env.PPS_USER_INFO_SERVICE_KEY;
    else process.env.PPS_USER_INFO_SERVICE_KEY = previous;
  });
  const client = createClient({ url: "file::memory:" });
  context.after(() => client.close());
  await migrateG2bDatabase(client);
  await client.executeMultiple(`
    INSERT INTO auth_users(id,email,nickname) VALUES ('a','a@example.test','a');
    INSERT INTO businesses(id,registration_number) VALUES (1,'2208162517');
    INSERT INTO user_businesses VALUES ('a',1);
    INSERT INTO business_basic VALUES (1,'{"corpNm":"기존 업체"}');
    INSERT INTO business_industry VALUES (1,'{"indstrytyCd":"0001"}');
    CREATE TRIGGER reject_basic BEFORE INSERT ON business_basic
      BEGIN SELECT RAISE(ABORT, '업무 저장 실패'); END;
  `);

  // 업종 1페이지에는 null과 누락을 포함하고, 2페이지는 처음에만 실패시킨다.
  let failPage = true;
  const pages = [];
  const logged = [];
  // 수집 실패 처리 중 콘솔에 기록하는 값도 저장값과 함께 검사한다.
  for (const method of ["log", "info", "warn", "error"]) {
    context.mock.method(console, method, (...args) => logged.push(...args));
  }
  context.mock.method(globalThis, "fetch", async (url) => {
    const page = Number(url.searchParams.get("pageNo"));
    pages.push(page);
    if (failPage && page === 2) {
      // 같은 키의 원문과 인코딩 값이 메시지와 중첩 예외에 포함되는 상황을 재현한다.
      throw new Error(`네트워크 오류 ${rawKey}`, { cause: new Error(`경로: ${url} / ${encodedKey}`) });
    }
    const item = page === 1
      ? { bizno: "2208162517", indstrytyCd: "0015", indstrytyNm: null }
      : { bizno: "2208162517", indstrytyCd: "0015", indstrytyNm: "" };
    return Response.json({ response: { header: { resultCode: "00" }, body: {
      items: [item], pageNo: page, numOfRows: 1, totalCount: 2,
    } } });
  });
  const service = openBusinessRegistration(new G2bDatabase(client), async (kind, number, date) => {
    // 업종은 실제 HTTP 파서를 사용하고 기본정보는 DB 쓰기 오류를 유도한다.
    if (kind === "industry") return collectBusinessApi(kind, number, date);
    if (kind === "basic") return [{ corpNm: "갱신 업체" }];
    return [];
  });
  await service.retry("a", 1);
  // 두 실패 유형의 기존 행은 유지하고 다른 5종의 완료 상태는 기록한다.
  const failed = (await client.execute("SELECT kind, status, error, diagnostics FROM business_collection ORDER BY kind")).rows;
  assert.equal(failed.filter(({ status }) => status === "succeeded").length, 5);
  const industry = failed.find(({ kind }) => kind === "industry");
  const basic = failed.find(({ kind }) => kind === "basic");
  assert.equal(basic.status, "failed");
  assert.equal(JSON.parse(basic.diagnostics).step, "사업자 정보 저장");
  assert.equal(industry.status, "failed");
  const diagnostic = JSON.parse(industry.diagnostics);
  assert.equal(diagnostic.step, "외부 API 요청");
  assert.equal(diagnostic.details.page, 2);
  assert.ok(!diagnostic.request.path.includes("?"));
  assert.ok(!JSON.stringify(industry).includes(rawKey));
  assert.ok(!JSON.stringify(industry).includes(encodedKey));
  assert.ok(!JSON.stringify(logged).includes(rawKey));
  assert.ok(!JSON.stringify(logged).includes(encodedKey));
  assert.match(diagnostic.cause.message, /인증 정보 생략/);
  assert.equal((await client.execute("SELECT payload FROM business_basic")).rows[0].payload, '{"corpNm":"기존 업체"}');
  assert.equal((await client.execute("SELECT payload FROM business_industry")).rows[0].payload, '{"indstrytyCd":"0001"}');

  // 장애 제거 후 실패 유형 전체를 재수집하고 구분되는 두 행과 오류 초기화를 확인한다.
  failPage = false;
  await client.execute("DROP TRIGGER reject_basic");
  await service.retry("a", 1);
  assert.deepEqual(pages, [1, 2, 1, 2]);
  assert.equal((await client.execute("SELECT COUNT(*) AS count FROM business_collection WHERE status = 'succeeded' AND error IS NULL AND diagnostics IS NULL")).rows[0].count, 7);
  const saved = (await client.execute("SELECT payload FROM business_industry")).rows.map(({ payload }) => JSON.parse(payload));
  assert.deepEqual(saved.map(({ indstrytyNm }) => indstrytyNm), ["", null]);
  assert.ok(saved.every((item) => item.indstrytyCd === "0015" && !Object.hasOwn(item, "rgstDt")));
});

/** SMPP의 명시적인 매칭 없음 응답과 같은 코드의 다른 장애를 구분한다. */
test("SMPP 3종의 매칭 없음은 완료하고 다른 업무 오류는 실패한다", async (context) => {
  // 동일한 결과 번호에 대한 두 문구를 가짜 HTTP 응답으로 비교한다.
  const { collectBusinessApi } = require("../src/features/business-information/server/collect-business-api");
  const previous = process.env.SMPP_CERT_INFO_SERVICE_KEY;
  process.env.SMPP_CERT_INFO_SERVICE_KEY = "sample";
  context.after(() => {
    // 테스트 키를 제거하고 기존 프로세스 환경을 복원한다.
    if (previous === undefined) delete process.env.SMPP_CERT_INFO_SERVICE_KEY;
    else process.env.SMPP_CERT_INFO_SERVICE_KEY = previous;
  });
  let message = "매칭데이터가 존재하지 않습니다.";
  context.mock.method(globalThis, "fetch", async () => new Response(`
    <response><HeaderValueList><resultCode>90</resultCode><resultMsg>${message}</resultMsg></HeaderValueList></response>
  `));
  // 세 API 모두 현재 기준일의 정상 빈 응답으로 처리되는지 확인한다.
  for (const kind of ["directProduction", "women", "disabled"]) {
    assert.deepEqual(await collectBusinessApi(kind, "2208162517", "20261126"), []);
  }
  // 임의의 외부 장애를 정상 빈 응답으로 저장하지 않는다.
  message = "시스템 오류";
  await assert.rejects(collectBusinessApi("women", "2208162517", "20261126"), /업무 오류/);
});

/** 실행권 만료 전후에 오래된 요청이 결과를 반영할 수 없는지 검증한다. */
test("만료된 실행권은 저장할 수 없으며 새 실행권으로 이어받는다", async (context) => {
  // 격리 환경에서 실행권 시간을 이동시키면서 저장소의 상태 전환을 확인한다.
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { openBusinessInformation } = require("../src/server/g2b/repository/business-information");
  const client = createClient({ url: "file::memory:" });
  context.after(() => client.close());
  await migrateG2bDatabase(client);
  await client.execute("INSERT INTO businesses(id,registration_number) VALUES (1,'2208162517')");
  const store = openBusinessInformation(new G2bDatabase(client));
  let now = 1_000;
  context.mock.method(Date, "now", () => now);
  assert.equal((await store.claim(1, "old", now, 2_000, "20261126")).length, 7);
  assert.deepEqual(await store.claim(1, "concurrent", now, 3_000, "20261126"), []);

  // 실행권이 만료되면 새로운 요청이 오기 전이라도 기존 호출 결과는 반영할 수 없다.
  now = 2_000;
  assert.equal(await store.complete(1, "basic", "old", [{ corpNm: "만료된 시도" }]), "lease-lost");
  assert.equal((await client.execute("SELECT * FROM business_basic")).rows.length, 0);
  assert.equal((await store.claim(1, "new", now, 3_000, "20261127")).length, 7);
  // 이전 실패 응답도 새 실행권을 지우지 않으며 새 실행만 데이터를 저장한다.
  assert.equal(await store.complete(1, "basic", "old", [{ corpNm: "인수된 시도" }]), "lease-lost");
  await store.fail(1, "basic", "old", { name: "Error", message: "지연된 실패" });
  assert.equal(await store.complete(1, "basic", "new", [{ corpNm: "새 시도" }]), "saved");
  assert.equal((await client.execute("SELECT payload FROM business_basic")).rows[0].payload, '{"corpNm":"새 시도"}');
  assert.equal((await client.execute("SELECT reference_date FROM business_collection WHERE kind = 'women'")).rows[0].reference_date, "20261127");
});

/** 실패 상태 저장이 거절돼도 두 진단을 정제해 남기고 다른 API를 완료한다. */
test("실패 기록 장애에서 수집 오류와 DB 오류를 안전하게 기록한다", async (context) => {
  // 실제 마이그레이션에 실패 갱신만 거절하는 트리거를 설치한다.
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { openBusinessRegistration } = require("../src/features/business-information/server/registration");
  const { collectionError } = require("../src/shared/api/g2b/collection-diagnostic");
  const client = createClient({ url: "file::memory:" });
  context.after(() => client.close());
  await migrateG2bDatabase(client);
  // 테스트용 인증값을 설정하고 테스트가 끝나면 원래 환경을 복원한다.
  const key = "fixture/service+key";
  const token = "fixture/database+token";
  const settings = { PPS_USER_INFO_SERVICE_KEY: key, TURSO_AUTH_TOKEN: token };
  for (const [name, value] of Object.entries(settings)) {
    const previous = process.env[name];
    process.env[name] = value;
    context.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  await client.executeMultiple(`
    INSERT INTO auth_users(id,email,nickname) VALUES ('a','a@example.test','a');
    CREATE TRIGGER reject_failure BEFORE UPDATE OF status ON business_collection WHEN NEW.status = 'failed'
      BEGIN SELECT RAISE(ABORT, '쓰기 오류 ${token} ${encodeURIComponent(token)}'); END;
  `);
  // 수집과 상태 저장 오류를 실제 호출부에서 처리하도록 콘솔 기록을 관측한다.
  const logger = context.mock.method(console, "error", () => {});
  const service = openBusinessRegistration(new G2bDatabase(client), async (kind) => {
    // 한 API의 실패와 다른 API의 실행권 인수를 독립적으로 재현한다.
    if (kind === "basic") {
      throw collectionError(new Error(`수집 오류 ${key} ${encodeURIComponent(key)}`), {
        step: "외부 요청", request: { path: "/business?marker=hidden" },
      });
    }
    if (kind === "industry") {
      await client.execute("UPDATE business_collection SET lease_token = 'replacement' WHERE kind = 'industry'");
    }
    return [];
  });
  // 나머지 API를 저장한 뒤 공개용 고정 메시지를 전달하고 인수된 실행권을 보존한다.
  await assert.rejects(service.register("a", "2208162517"), { message: "일부 사업자 정보의 수집 상태를 저장하지 못했습니다." });
  const states = (await client.execute("SELECT kind, status, lease_token FROM business_collection")).rows;
  assert.equal(states.filter(({ status }) => status === "succeeded").length, 5);
  assert.equal(states.find(({ kind }) => kind === "industry").lease_token, "replacement");
  // 두 진단의 메시지와 요청 경로를 검사하되 비밀값과 쿼리는 남기지 않는다.
  assert.equal(logger.mock.callCount(), 1);
  const [, id, kind, original, write] = logger.mock.calls[0].arguments;
  assert.equal(id, 1);
  assert.equal(kind, "basic");
  assert.match(original.message, /수집 오류/);
  assert.equal(original.request.path, "/business");
  assert.match(write.message, /쓰기 오류/);
  const logged = JSON.stringify(logger.mock.calls[0].arguments);
  for (const secret of [key, token, encodeURIComponent(key), encodeURIComponent(token), "marker=hidden"]) {
    assert.ok(!logged.includes(secret));
  }
});

/** HTTP 응답 유무와 헤더에 따라 기존 진단에 콘텐츠 유형을 포함한다. */
test("응답 오류 진단은 수신한 Content-Type만 기록한다", async (context) => {
  // 테스트 환경에서 HTTP 오류, 해석 오류, 헤더 없음, 연결 실패를 순서대로 재현한다.
  const { collectBusinessApi } = require("../src/features/business-information/server/collect-business-api");
  const { describeCollectionError } = require("../src/shared/api/g2b/collection-diagnostic");
  const previous = process.env.PPS_USER_INFO_SERVICE_KEY;
  process.env.PPS_USER_INFO_SERVICE_KEY = "fixture";
  context.after(() => {
    if (previous === undefined) delete process.env.PPS_USER_INFO_SERVICE_KEY;
    else process.env.PPS_USER_INFO_SERVICE_KEY = previous;
  });
  const cases = [
    [new Response(null, { status: 503, headers: { "Content-Type": "text/html" } }), "text/html"],
    [new Response("{", { headers: { "Content-Type": "application/json" } }), "application/json"],
    [new Response(null, { status: 503 }), undefined],
    [null, undefined],
  ];
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("연결 실패");
  });
  for (const [response, expected] of cases) {
    if (response) fetchMock.mock.mockImplementationOnce(async () => response);
    await assert.rejects(collectBusinessApi("basic", "2208162517", "20261126"), (error) => {
      // 공통 진단으로 변환한 필드와 응답 자체의 유무를 검증한다.
      const diagnostic = describeCollectionError(error);
      assert.equal(diagnostic.response?.contentType, expected);
      if (!response) assert.equal(diagnostic.response, undefined);
      return true;
    });
  }
});

/** 사용자 목록과 상세 조회에서 사업자 간 데이터가 섞이지 않는지 검증한다. */
test("마이페이지는 등록된 사업자의 요약과 선택한 상세만 읽는다", async (context) => {
  // 실제 마이그레이션에 서로 다른 사용자와 사업자 및 부분 수집 결과를 준비한다.
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { G2bDatabase } = require("../src/server/g2b/repository/database");
  const { openBusinessInformation } = require("../src/server/g2b/repository/business-information");
  const client = createClient({ url: "file::memory:" });
  context.after(() => client.close());
  await migrateG2bDatabase(client);
  await client.executeMultiple(`
    INSERT INTO auth_users(id,email,nickname) VALUES ('a','a@example.test','a'),('b','b@example.test','b');
    INSERT INTO businesses VALUES (1,'2208162517'),(2,'6168122531'),(3,'3808100318');
    INSERT INTO user_businesses VALUES ('a',1),('a',3),('b',2);
    INSERT INTO business_basic VALUES (1,'{"corpNm":"공유 업체","ceoNm":"상세 전용"}'),
      (1,'{"adrs":"가","corpNm":""}'),(2,'{"corpNm":"다른 업체"}');
    INSERT INTO business_smpp VALUES (1,'women','{"certSeCode":"03"}'),(2,'women','{"certSeCode":"03","issuInstt":"다른 업체"}');
    INSERT INTO business_collection(business_id,kind,status,error,diagnostics)
      VALUES (1,'women','failed','상세 내부 오류','{"name":"서버 전용"}'),(1,'sanction','succeeded',NULL,NULL);
  `);
  const store = openBusinessInformation(new G2bDatabase(client));
  // 목록에는 요약만, 상세에는 선택 사업자의 항목과 화면용 수집 상태만 제공한다.
  assert.deepEqual(await store.listForUser("a"), [
    { id: 1, number: "2208162517", name: "공유 업체" },
    { id: 3, number: "3808100318", name: null },
  ]);
  assert.equal(await store.detailForUser("a", 2), undefined);
  assert.equal(await store.detailForUser("a", 999), undefined);
  const detail = await store.detailForUser("a", 1);
  assert.equal(detail.number, "2208162517");
  assert.deepEqual(detail.sections.women, { status: "failed", items: [{ certSeCode: "03" }] });
  assert.deepEqual(detail.sections.sanction, { status: "succeeded", items: [] });
  assert.deepEqual(detail.sections.product, { status: "incomplete", items: [] });
  assert.ok(!JSON.stringify(detail).includes("서버 전용"));
});
