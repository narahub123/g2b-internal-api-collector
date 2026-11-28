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
  reads.length = 0;
  assert.deepEqual(await Promise.all([store.getRows(), store.getRows()]), [['second'], ['second']]);
  assert.equal(reads.filter(([path, cache]) => path.includes('/rows/') && cache).length, 1);
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
