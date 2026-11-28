// Blob 경합과 전송 횟수를 원격 저장소 없이 재현한다.
const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { BlobPreconditionFailedError } = require('@vercel/blob');
require('../scripts/register-project-typescript.cjs');
const { CollectionBusyError, createBlobCollectionStore } = require('../src/server/collections/blob-collection-store.ts');
const { importLocalCollection } = require('../src/server/collections/import-local-collection.ts');

/**
 * 조건부 쓰기와 응답 유실을 재현하는 메모리 Blob을 만든다.
 * @returns 테스트용 저장소와 기록, 결함 주입 상태.
 */
function setup() {
  // 각 시나리오는 캐시 경로까지 서로 격리한다.
  const objects = new Map();
  const reads = [];
  const writes = [];
  const fault = {};
  let etag = 0;
  const client = {
    /**
     * 현재 객체와 CDN 사용 여부를 기록한다.
     * @param {string} path 읽을 객체.
     * @param {object} options 읽기 정책.
     * @returns 존재하는 객체 또는 null.
     */
    async get(path, options) {
      reads.push([path, options.useCache]);
      if (fault.beforeRead) fault.beforeRead(path);
      const stored = objects.get(path);
      // 읽은 버전이 이후 갱신보다 늦게 도착하는 상황을 재현한다.
      if (fault.afterRead) await fault.afterRead(path);
      return stored ? { statusCode: 200, stream: new Response(stored.body).body, blob: stored } : null;
    },
    /**
     * 조건을 확인한 뒤 객체를 쓰거나 설정된 실패를 재현한다.
     * @param {string} path 기록할 객체.
     * @param {string} body JSON 본문.
     * @param {object} options 쓰기 전제 조건.
     * @returns 기록한 객체의 ETag.
     */
    async put(path, body, options) {
      writes.push(path);
      const old = objects.get(path);
      if ((old && !options.allowOverwrite) || (options.ifMatch && old?.etag !== options.ifMatch)) {
        throw new BlobPreconditionFailedError();
      }
      if (path.endsWith('metadata.json') && fault.conflict) throw new BlobPreconditionFailedError();
      if (path.includes('/rows/') && fault.uploadFailure) throw new Error('모의 목록 업로드 실패');
      const stored = { body, etag: String(++etag) };
      objects.set(path, stored);
      if (path.endsWith('metadata.json') && fault.lostResponse) throw new Error('모의 응답 유실');
      return stored;
    },
    /**
     * 소유권 조건과 일치하는 객체만 삭제한다.
     * @param {string} path 삭제할 객체.
     * @param {object} options 삭제 전제 조건.
     */
    async del(path, options) {
      if (options.ifMatch && objects.get(path)?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
      objects.delete(path);
    },
  };
  const id = 'test-' + randomUUID();
  const store = createBlobCollectionStore(id, {
    readMetadata: ({ version }) => ({ version }),
    readRows: (rows) => rows,
  }, client);
  return { store, client, objects, reads, writes, fault, base: (process.env.DICTIONARY_BLOB_PREFIX || 'dictionaries') + '/' + id };
}

/** 이전, 캐시, 무변경과 조건부 교체 실패 시 적용 자료의 보존을 검증한다. */
async function verifyStore() {
  const { store, objects, reads, writes, fault, base } = setup();
  assert.equal(await store.getRows(), undefined);
  const source = async () => ({ metadata: { version: 1 }, rows: ['first'] });
  assert.deepEqual(await importLocalCollection(store, source), { status: 'imported', rows: 1 });
  assert.deepEqual(await importLocalCollection(store, () => assert.fail('기존 Blob이 있으면 원본 접근 금지')), { status: 'skipped' });
  reads.length = writes.length = 0;
  assert.deepEqual(await store.getMetadata(), { version: 1 });
  assert.deepEqual(await store.getRows(), ['first']);
  assert.deepEqual(await store.getRows(), ['first']);
  await store.run(async (current) => assert.deepEqual(current, { version: 1 }));
  assert.ok(reads.every(([path, cache]) => path === base + '/metadata.json' && cache === false));
  assert.deepEqual(writes, [base + '/lease.json']);

  // 메타데이터만 쓴 뒤에는 여전히 기존 세대를 사용한다.
  reads.length = writes.length = 0;
  await store.run(async (_, save) => save({ version: 2 }));
  assert.deepEqual(writes, [base + '/lease.json', base + '/metadata.json']);
  assert.deepEqual(await store.getRows(), ['first']);
  assert.ok(reads.every(([path]) => !path.includes('/rows/')));

  // 목록 업로드 실패와 조건부 교체 실패는 현재 세대를 보존한다.
  fault.uploadFailure = true;
  await assert.rejects(store.run(async (_, save) => save({ version: 3 }, ['second'])), /모의 목록 업로드 실패/);
  assert.deepEqual(await store.getMetadata(), { version: 2 });
  fault.uploadFailure = false;
  fault.conflict = true;
  await assert.rejects(store.run(async (_, save) => save({ version: 3 }, ['second'])), BlobPreconditionFailedError);
  assert.deepEqual(await store.getRows(), ['first']);
  assert.equal([...objects.keys()].filter((path) => path.includes('/rows/')).length, 1);
  fault.conflict = false;

  // 커밋 요청의 응답이 유실돼도 적용본 확인 후 정상 결과를 반환한다.
  fault.lostResponse = true;
  await store.run(async (_, save) => save({ version: 3 }, ['second']));
  assert.deepEqual(await store.getMetadata(), { version: 3 });
  reads.length = 0;
  assert.deepEqual(await Promise.all([store.getRows(), store.getRows()]), [['second'], ['second']]);
  assert.equal(reads.filter(([path, cache]) => path.includes('/rows/') && cache).length, 1);
}

/**
 * 사전 메타데이터의 수명, 중복 조회 및 실패 재시도를 검증한다.
 * @param {import('node:test').TestContext} env 시계를 수동으로 이동시킬 테스트 환경.
 */
async function verifyMetadataCache(env) {
  // 실제 대기 시간 없이 만료 전후의 조회 호출 수를 비교한다.
  env.mock.timers.enable({ apis: ['Date'], now: 0 });
  const { store, objects, reads, fault, base } = setup();
  const path = base + '/metadata.json';
  assert.deepEqual(await Promise.all([store.getMetadata(), store.getMetadata()]), [undefined, undefined]);
  assert.equal(reads.length, 1);
  assert.equal(await store.getMetadata(), undefined);
  assert.equal(reads.length, 1);

  // 최초 저장 이후 다른 인스턴스가 바꾼 값은 만료 뒤 조회에서 나타난다.
  await store.run(async (_, save) => save({ version: 1 }, ['first']));
  const manifest = JSON.parse(objects.get(path).body);
  assert.deepEqual(await store.getMetadata(), { version: 1 });
  objects.set(path, { body: JSON.stringify({ ...manifest, version: 2 }), etag: 'external' });
  reads.length = 0;
  env.mock.timers.tick(29_999);
  assert.deepEqual(await store.getMetadata(), { version: 1 });
  assert.equal(reads.length, 0);
  env.mock.timers.tick(1);
  fault.beforeRead = () => { throw new Error('모의 읽기 실패'); };
  await assert.rejects(store.getMetadata(), /모의 읽기 실패/);
  fault.beforeRead = undefined;
  assert.deepEqual(await Promise.all([store.getMetadata(), store.getMetadata()]), [{ version: 2 }, { version: 2 }]);
  assert.deepEqual(reads, [[path, false], [path, false]]);

  // 화면 값이 남아 있어도 상세의 세대 확인과 수집은 원본 메타데이터를 다시 읽는다.
  const next = base + '/rows/' + randomUUID() + '.json';
  objects.set(next, { body: '["latest"]', etag: 'rows-next' });
  objects.set(path, { body: JSON.stringify({ ...manifest, listFile: next, version: 3 }), etag: 'external-next' });
  assert.deepEqual(await store.getRows(), ['latest']);
  await assert.rejects(store.run(async () => { throw new Error('모의 수집 실패'); }), /모의 수집 실패/);
  assert.deepEqual(await store.getMetadata(), { version: 2 });
  await store.run(async (current) => assert.deepEqual(current, { version: 3 }));
  reads.length = 0;
  assert.deepEqual(await store.getMetadata(), { version: 3 });
  assert.equal(reads.length, 0);

  // 성공일만 저장하는 경로에서도 표시용 캐시가 무효화된다.
  await store.run(async (_, save) => save({ version: 4 }));
  reads.length = 0;
  assert.deepEqual(await store.getMetadata(), { version: 4 });
  assert.deepEqual(reads, [[path, false]]);
}

/** 이전 표시 응답이 수집 후 도착해도 새 캐시를 덮어쓰지 않는지 확인한다. */
async function verifyMetadataRace() {
  const { store, reads, fault, base } = setup();
  const path = base + '/metadata.json';
  const held = Promise.withResolvers();
  // 첫 조회만 이전 미수집 상태를 확보한 채로 대기한다.
  fault.afterRead = async (requested) => {
    if (requested !== path) return;
    fault.afterRead = undefined;
    await held.promise;
  };
  const old = store.getMetadata();
  await store.run(async (_, save) => save({ version: 1 }, ['new']));
  assert.deepEqual(await store.getMetadata(), { version: 1 });
  held.resolve();
  assert.equal(await old, undefined);
  reads.length = 0;
  assert.deepEqual(await store.getMetadata(), { version: 1 });
  assert.equal(reads.length, 0);
}

/** 실행 중 잠금 충돌과 만료 잠금의 회수를 확인한다. */
async function verifyLock() {
  const { store, client, base } = setup();
  const entered = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const first = store.run(async () => {
    entered.resolve();
    return finish.promise;
  });
  await entered.promise;
  await assert.rejects(store.run(async () => assert.fail('잠긴 동안 수집 금지')), CollectionBusyError);
  finish.resolve();
  await first;
  await client.put(base + '/lease.json', JSON.stringify({ owner: 'old', expiresAt: 1 }), {});
  assert.equal(await store.run(async () => '회수 완료'), '회수 완료');
}

/** 이전 참조가 조회 중 사라지면 최신 세대를 한 번 다시 읽는지 확인한다. */
async function verifyRace() {
  const { store, objects, fault, base } = setup();
  const path = base + '/metadata.json';
  await store.run(async (_, save) => save({ version: 1 }, ['old']));
  const old = JSON.parse(objects.get(path).body);
  const next = base + '/rows/' + randomUUID() + '.json';
  fault.beforeRead = function switchGeneration(requested) {
    if (requested !== old.listFile) return;
    objects.delete(old.listFile);
    objects.set(next, { body: '["new"]', etag: 'rows' });
    objects.set(path, { body: JSON.stringify({ ...old, version: 2, listFile: next }), etag: 'next' });
  };
  assert.deepEqual(await store.getRows(), ['new']);
}

test('Blob 이전, 캐시, 무변경 및 조건부 교체', verifyStore);
test('Blob 잠금 충돌 및 만료 회수', verifyLock);
test('Blob 조회 중 세대 교체', verifyRace);
test('표시 메타데이터 만료, 요청 공유, 수집 후 반영', verifyMetadataCache);
test('수집 전 지연된 표시 응답이 캐시를 덮어쓰지 않음', verifyMetadataRace);
