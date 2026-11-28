// 실제 SQLite 마이그레이션과 워커의 예약 판단을 원격 서비스 없이 검증한다.
require("../scripts/register-project-typescript.cjs");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations.ts");
const { G2bDatabase } = require("../src/server/g2b/repository/database.ts");
const { dictionaryQueueQueries, dictionaryRetryMs, openDictionaryQueue } = require("../src/server/collections/dictionary-queue.ts");
const { runDictionaryWorker } = require("../src/server/collections/dictionary-worker.ts");

/**
 * 초기 설정과 마이그레이션 이전 공고의 설정 보존을 확인한다.
 * @param {import('node:test').TestContext} t 연결 정리용 테스트 컨텍스트.
 */
async function verifyMigration(t) {
  // 전환 전 공고 상태를 재현한 뒤 새 마이그레이션만 다시 적용한다.
  const client = createClient({ url: ":memory:" });
  t.after(() => client.close());
  await migrateG2bDatabase(client);
  await client.executeMultiple(`
    DROP VIEW g2b_notice_automatic_state;
    DROP TABLE dictionary_jobs; DROP TABLE dictionary_worker;
    DROP TABLE dictionary_schedule_state; DROP TABLE collection_schedule_settings;
    DELETE FROM g2b_schema_migrations WHERE version = 44;
    UPDATE g2b_notice_automatic SET enabled = 1, interval = 120, startMinute = '202611270310',
      generation = 9, immediate = 1, nextAt = 123 WHERE id = 1;
  `);
  await migrateG2bDatabase(client);
  const { rows: [notice] } = await client.execute("SELECT enabled,interval,startMinute,generation,immediate,nextAt FROM g2b_notice_automatic_state");
  assert.deepEqual(Object.values(notice), [1, 120, "202611270310", 9, 1, 123]);
  const queue = openDictionaryQueue(new G2bDatabase(client));
  const settings = await queue.settings();
  assert.equal(settings.length, 2);
  assert.ok(settings.every(({ enabled, days }) => !enabled && days === 7));

  // 반복 조회가 대상별 인덱스를 사용하고 무관한 후보를 읽지 않는지 확인한다.
  for (const [key, args, expected] of [
    ["expired", [0], "dictionary_job_running"],
    ["due", [0], "dictionary_schedule_due"],
    ["ready", ["manual", 0], "dictionary_job_ready"],
    ["cleanup", [0], "dictionary_job_cleanup"],
  ]) {
    const { rows } = await client.execute({ sql: "EXPLAIN QUERY PLAN " + dictionaryQueueQueries[key], args });
    t.diagnostic(rows.map(({ detail }) => detail).join(" | "));
    assert.ok(rows.some(({ detail }) => detail.includes(expected)));
    assert.ok(rows.every(({ detail }) => !detail.includes("USE TEMP B-TREE")));
  }
}

/**
 * 같은 실행에서의 15분 대기, 실행권 반환과 보존 정책을 검증한다.
 * @param {import('node:test').TestContext} t 연결 정리용 테스트 컨텍스트.
 */
async function verifyRetry(t) {
  const client = createClient({ url: ":memory:" });
  t.after(() => client.close());
  await migrateG2bDatabase(client);
  const queue = openDictionaryQueue(new G2bDatabase(client));
  let now = 10_000;
  await queue.configure("industry-law", true, 7, now);
  // 겹친 스케줄러 호출에도 같은 사전은 한 번만 접수된다.
  await Promise.all([queue.tick(now), queue.tick(now)]);
  let attempts = 0;
  let manualId;

  /**
   * 업종의 첫 두 실행만 오류로 마친다.
   * @returns 수집 성공 상태.
   */
  async function collectIndustry() {
    attempts++;
    if (attempts < 3) throw new Error("모의 원본 오류");
    return { status: "unchanged" };
  }

  /**
   * 실제 대기 대신 시계를 진행하며 대기 중 수동 선점을 검증한다.
   * @param {number} milliseconds 예정된 대기 시간.
   */
  async function wait(milliseconds) {
    assert.equal(milliseconds, dictionaryRetryMs);
    if (!manualId) {
      [manualId] = await queue.enqueueManual(["legal-districts"], now);
      const manual = await queue.claim(now);
      assert.equal(manual.key, "legal-districts");
      await queue.finish(manual.id, manual.token, "updated", now);
    }
    assert.equal((await queue.claim(now)).kind, "empty");
    now += milliseconds;
  }

  assert.equal(await runDictionaryWorker({ queue, collect: { "industry-law": collectIndustry }, clock: () => now, wait }), true);
  assert.equal(attempts, 3);
  const settings = await queue.settings();
  // 변경이 없는 최종 성공도 마지막 확인과 다음 실행 일정에 함께 반영된다.
  const industry = settings.find(({ key }) => key === "industry-law");
  assert.equal(industry.lastSuccessAt, now);
  assert.equal(industry.nextAt, now + 7 * 86_400_000);
  assert.equal(settings.find(({ key }) => key === "legal-districts").nextAt, null);
  // 24시간이 되기 직전과 실제 경계에서 삭제 대상을 비교한다.
  const old = 86_400_000 + 10_000;
  assert.equal(await queue.cleanup(true, old - 1), 0);
  assert.equal(await queue.cleanup(true, old), 1);
  assert.equal((await queue.jobs([manualId])).length, 1);
  assert.equal(await queue.cleanup(false, old), 1);
  assert.equal((await queue.jobs([manualId])).length, 0);
  assert.deepEqual(Object.values((await client.execute("SELECT status,failures,had_failure FROM dictionary_jobs")).rows[0]), ["succeeded", 2, 1]);
}

/**
 * 중단된 실행 복구, 수동 승격과 비활성화에 따른 취소를 확인한다.
 * @param {import('node:test').TestContext} t 연결 정리용 테스트 컨텍스트.
 */
async function verifyRecovery(t) {
  const client = createClient({ url: ":memory:" });
  t.after(() => client.close());
  await migrateG2bDatabase(client);
  const queue = openDictionaryQueue(new G2bDatabase(client));
  await queue.configure("industry-law", true, 7, 1);
  await queue.configure("legal-districts", true, 8, 1);
  await queue.tick(1);
  const [manual] = await queue.enqueueManual(["legal-districts"], 1);
  const first = await queue.claim(1);
  assert.equal(first.id, manual);
  assert.deepEqual(await queue.enqueueManual(["legal-districts"], 2), [manual]);
  assert.equal((await queue.claim(2)).kind, "busy");
  // 다음 정기 호출이 강제 종료로 남은 실행을 먼저 복구한다.
  const next = 86_400_001;
  await queue.tick(next);
  const recovered = await queue.claim(next);
  assert.equal(recovered.id, first.id);
  await assert.rejects(queue.finish(first.id, first.token, "updated", next), /실행권 상실/);
  await queue.finish(recovered.id, recovered.token, "unchanged", next);
  const auto = await queue.claim(next);
  assert.equal(auto.key, "industry-law");
  await queue.finish(auto.id, auto.token, { retry: true }, next);
  await queue.configure("industry-law", false, 7, next + 1);
  assert.equal((await queue.jobs([auto.id]))[0].status, "cancelled");
  assert.equal((await queue.claim(next + dictionaryRetryMs)).kind, "empty");
}

test("공용 설정 전환과 정기·선점·삭제 인덱스", verifyMigration);
test("실패한 실행의 15분 재시도와 24시간 기록 정리", verifyRetry);
test("수동 우선 선점, 실행권 복구 및 비활성화", verifyRecovery);

/**
 * 원래 만료 시각을 지나도 처리 중에는 다른 워커가 선점하지 못하는지 확인한다.
 * @param {import('node:test').TestContext} t 연결 정리용 테스트 컨텍스트.
 */
async function verifyHeartbeat(t) {
  // 실제 큐를 사용하되 시계를 이동하여 5분을 기다리지 않고 확인한다.
  const client = createClient({ url: ":memory:" });
  t.after(() => client.close());
  await migrateG2bDatabase(client);
  const queue = openDictionaryQueue(new G2bDatabase(client));
  let now = 1;
  const [id] = await queue.enqueueManual(["industry-law"], now);
  // 첫 갱신이 DB에 반영된 순간에만 수집 검증을 진행한다.
  const renewed = Promise.withResolvers();
  /**
   * 실제 실행권을 변경하고 수집 테스트에 결과를 알린다.
   * @param {string} token 선점 토큰.
   * @param {number} at 갱신 시각.
   * @returns 갱신 성공 여부.
   */
  async function renew(token, at) {
    const result = await queue.renew(token, at);
    renewed.resolve(result);
    return result;
  }
  /**
   * 한 번 갱신한 뒤 다음 갱신 예약은 작업 종료에 맞춰 취소된다.
   * @param {number} milliseconds 갱신 주기.
   * @param {undefined} value 대기 함수 반환값.
   * @param {{signal: AbortSignal}} options 타이머를 취소할 신호.
   */
  async function waitForRenewal(milliseconds, value, { signal }) {
    if (now === 1) {
      now += milliseconds;
      return;
    }
    await require("node:timers/promises").setTimeout(milliseconds, value, { signal });
  }
  /**
   * 기존 만료 시각에서 실행권이 유지되고 정상 완료되는지 확인한다.
   * @returns 변경 없는 수집 결과.
   */
  async function collect() {
    assert.equal(await renewed.promise, true);
    now = 300_001;
    assert.equal((await queue.claim(now)).kind, "busy");
    return { status: "unchanged" };
  }
  assert.equal(await runDictionaryWorker({
    queue: { ...queue, renew }, clock: () => now, waitForRenewal, collect: { "industry-law": collect },
  }), false);
  assert.equal((await queue.jobs([id]))[0].status, "succeeded");
}

/**
 * 중단 복구가 동일 자동 작업의 재시도 한도를 적용하는지 검증한다.
 * @param {import('node:test').TestContext} t 연결 정리용 테스트 컨텍스트.
 */
async function verifyRepeatedExpiry(t) {
  // 마이그레이션을 적용한 실제 큐에서 자동 확인을 한 건 접수한다.
  const client = createClient({ url: ":memory:" });
  t.after(() => client.close());
  await migrateG2bDatabase(client);
  const queue = openDictionaryQueue(new G2bDatabase(client));
  let now = 1;
  await queue.configure("industry-law", true, 7, now);
  await queue.tick(now);
  const first = await queue.claim(now);
  // 최초 실행과 두 재시도를 종료 기록 없이 만료시킨다.
  for (let attempt = 1, job = first; attempt <= 3; attempt++) {
    assert.equal(job.id, first.id);
    now += 300_000;
    assert.equal(await queue.renew(job.token, now), false);
    // 중복 복구 호출에서도 만료 한 건만 집계된다.
    await queue.tick(now);
    assert.equal((await queue.claim(now)).kind, "empty");
    if (attempt < 3) {
      assert.equal((await queue.jobs([first.id]))[0].status, "retry_wait");
      now += dictionaryRetryMs;
      job = await queue.claim(now);
    }
  }
  // 마지막 성공 기록을 추가하지 않고 다음 정기 일정만 예약한다.
  assert.deepEqual(Object.values((await client.execute("SELECT status, failures, had_failure FROM dictionary_jobs")).rows[0]),
    ["failed", 3, 1]);
  const schedule = (await queue.settings()).find(({ key }) => key === "industry-law");
  assert.equal(schedule.lastSuccessAt, null);
  assert.equal(schedule.nextAt, now + 7 * 86_400_000);
}

test("사전 워커가 최초 실행권 만료 시각을 넘어 갱신한다", verifyHeartbeat);
test("비정상 종료 세 번 이후 동일 자동 작업을 재시도하지 않는다", verifyRepeatedExpiry);

/**
 * 갱신이 거부되면 수집 신호를 중단하고 이전 토큰으로 완료하지 않는지 확인한다.
 */
async function verifyLostLease() {
  // 갱신 시점에 이미 실행권이 만료됐다고 응답하는 큐다.
  const queue = {
    claim: async () => ({ kind: "job", id: 1, key: "industry-law", token: "expired" }),
    renew: async () => false,
    finish: async () => assert.fail("만료된 워커는 완료를 기록할 수 없습니다."),
  };
  /**
   * 수집기가 실행권 상실 신호를 받는 순간을 기다린다.
   * @param {{signal: AbortSignal}} options 수집 중단 신호.
   * @returns 중단을 받은 뒤 반환한 모의 결과.
   */
  async function collect({ signal }) {
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    assert.equal(signal.aborted, true);
    return { status: "unchanged" };
  }
  // 수집 함수가 정상 결과를 반환해도 큐 완료는 진행하지 않는다.
  await assert.rejects(runDictionaryWorker({
    queue, waitForRenewal: async () => {}, collect: { "industry-law": collect },
  }), /실행권 상실/);
}

test("사전 워커가 실행권을 잃으면 수집을 중단하고 완료 상태를 쓰지 않는다", verifyLostLease);
