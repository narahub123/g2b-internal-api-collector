const assert = require("node:assert/strict");
const { test } = require("node:test");
const { v2: cloudinary } = require("cloudinary");
require("../scripts/register-project-typescript.cjs");

/** SDK 계약과 비공개 다운로드 및 목록의 Turso 경로 호환성을 검증한다. */
test("Cloudinary 프로필 어댑터가 인증된 이미지 ID와 서명 다운로드를 사용한다", async (context) => {
  // 실제 서명 함수에는 테스트용 서버 자격 증명만 전달한다.
  const open = require("../src/server/auth/profile-storage").openProfileStorage;
  const key = "profile-images/dXNlcg/11111111-1111-1111-1111-111111111111.webp";
  const publicId = key.slice(0, -5);
  const bytes = Buffer.from("test image");
  const settings = { CLOUDINARY_CLOUD_NAME: "profile-test", CLOUDINARY_API_KEY: "12345", CLOUDINARY_API_SECRET: "fixture-secret" };
  const saved = Object.fromEntries(Object.keys(settings).map((name) => [name, process.env[name]]));
  Object.assign(process.env, settings);
  context.after(() => {
    // 외부 환경을 원래 상태로 복원한다.
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  // 전송 경계에서 SDK 옵션을 검증하고 네트워크 없이 결과를 돌려준다.
  const upload = context.mock.method(cloudinary.uploader, "upload_stream", (options, callback) => ({
    /** 테스트 이미지가 실제 전송 스트림에 전달되는지 확인한다. */
    end(data) { assert.deepEqual(data, bytes); callback(undefined, { public_id: options.public_id }); },
  }));
  const remove = context.mock.method(cloudinary.uploader, "destroy", async () => ({ result: "ok" }));
  const list = context.mock.method(cloudinary.api, "resources", async ({ next_cursor }) => next_cursor
    ? { resources: [{ public_id: publicId, format: "webp", created_at: "2026-01-01T00:00:00Z" }] }
    : { resources: [], next_cursor: "page-2" });
  const request = context.mock.method(globalThis, "fetch", async () => new Response(bytes));
  const storage = open();
  await storage.put(key, bytes);
  assert.equal(upload.mock.calls[0].arguments[0].public_id, publicId);
  assert.equal(upload.mock.calls[0].arguments[0].type, "authenticated");
  assert.equal(upload.mock.calls[0].arguments[0].overwrite, false);
  assert.deepEqual(Buffer.from(await storage.read(key)), bytes);
  const url = new URL(request.mock.calls[0].arguments[0]);
  assert.equal(url.pathname, "/v1_1/profile-test/image/download");
  assert.equal(url.searchParams.get("public_id"), publicId);
  assert.equal(url.searchParams.get("type"), "authenticated");
  assert.ok(url.searchParams.get("signature"));
  assert.ok(Number(url.searchParams.get("expires_at")) - Date.now() / 1000 <= 60);
  assert.equal(request.mock.calls[0].arguments[1].cache, "no-store");
  // 없는 객체와 권한 실패를 다르게 처리한다.
  request.mock.mockImplementation(async () => new Response(null, { status: 404 }));
  assert.equal(await storage.read(key), undefined);
  request.mock.mockImplementation(async () => new Response(null, { status: 403 }));
  await assert.rejects(storage.read(key), /403/);
  // 삭제·페이지 조회에도 같은 보호 유형을 적용한다.
  await storage.remove(key);
  assert.equal(remove.mock.calls[0].arguments[0], publicId);
  assert.equal(remove.mock.calls[0].arguments[1].type, "authenticated");
  const objects = [];
  for await (const object of storage.list()) objects.push(object);
  assert.deepEqual(objects, [{ key, createdAt: new Date("2026-01-01T00:00:00Z") }]);
  assert.equal(list.mock.calls[0].arguments[0].prefix, "profile-images/");
  assert.equal(list.mock.calls[1].arguments[0].next_cursor, "page-2");
});

/** 이미지 API가 소유자와 버전을 확인한 뒤에만 공급자를 호출하는지 검증한다. */
test("비로그인·다른 사용자·이전 버전의 이미지 요청은 저장소에 도달하지 않는다", async (context) => {
  // Next.js 요청 인증과 외부 저장소만 대체하고 실제 라우트의 접근 판단을 사용한다.
  const verificationPath = require.resolve("../src/server/auth/current-user.ts");
  const storagePath = require.resolve("../src/server/auth/profile-storage.ts");
  const routePath = require.resolve("../app/api/auth/profile/image/route.ts");
  const previousStorage = require.cache[storagePath];
  const version = "11111111-1111-1111-1111-111111111111";
  const key = "profile-images/dXNlcg/" + version + ".webp";
  let auth = { status: "unauthenticated" };
  let reads = 0;
  require.cache[verificationPath] = { loaded: true, exports: {
    /** 검증하려는 시나리오의 현재 로그인 결과를 전달한다. */
    async verifyCurrentUser() { return auth; },
  } };
  require.cache[storagePath] = { loaded: true, exports: {
    /** 승인된 경로로 호출된 공급자 읽기만 기록한다. */
    openProfileStorage() {
      return {
        /** 인증과 버전 비교가 끝난 경로의 이미지 바이트를 반환한다. */
        async read(path) { assert.equal(path, key); reads += 1; return new Uint8Array([1, 2, 3]); },
      };
    },
  } };
  context.after(() => {
    // 다음 테스트에서는 실제 저장소 모듈을 다시 사용할 수 있게 한다.
    delete require.cache[verificationPath];
    delete require.cache[routePath];
    require.cache[storagePath] = previousStorage;
  });
  const { GET } = require(routePath);
  const current = new Request("https://example.test/api/auth/profile/image?v=" + version);
  assert.equal((await GET(current)).status, 401);
  auth = { status: "authenticated", user: { id: "other" }, state: { image: key } };
  assert.equal((await GET(current)).status, 404);
  auth.user.id = "user";
  const stale = await GET(new Request("https://example.test/api/auth/profile/image?v=stale"));
  assert.equal(stale.status, 404);
  assert.equal(stale.headers.get("cache-control"), "no-store");
  assert.equal(reads, 0);
  // 현재 소유자의 성공 응답에만 브라우저 전용 캐시와 WebP 유형을 부여한다.
  const response = await GET(current);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, max-age=300");
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  assert.equal(reads, 1);
});

/** 미리보기 및 실제 정리에서 오래된 미참조 파일만 선택하는지 확인한다. */
test("프로필 정리는 최근 이미지와 참조 중인 이미지를 보존한다", async () => {
  // 24시간 경계의 양쪽과 현재 참조 여부를 재현할 경로를 준비한다.
  const { cleanupProfileImages } = require("../scripts/profile-images-cleanup.cjs");
  const cutoff = Date.parse("2026-01-02T00:00:00Z");
  const active = "profile-images/dXNlcg/11111111-1111-1111-1111-111111111111.webp";
  const orphan = active.replaceAll("1", "2");
  const recent = active.replaceAll("1", "3");
  const deleted = [];
  const storage = {
    /** 실제 어댑터의 경로 및 생성 시각 계약으로 픽스처를 반환한다. */
    async *list() {
      yield { key: active, createdAt: new Date(cutoff - 1) };
      yield { key: orphan, createdAt: new Date(cutoff) };
      yield { key: recent, createdAt: new Date(cutoff + 1) };
    },
    /** 실제 삭제 호출을 기록한다. */
    async remove(key) { deleted.push(key); },
  };
  const repository = {
    /** 객체에 포함된 내부 사용자 ID로 현재 참조를 조회한다. */
    async findUserState(id) { assert.equal(id, "user"); return { image: active }; },
  };
  // 미리보기는 후보만 센다. 실제 실행은 동일한 후보만 삭제한다.
  assert.deepEqual(await cleanupProfileImages(storage, repository, { apply: false, cutoff }),
    { apply: false, candidates: 1, removed: 0, failed: 0 });
  assert.deepEqual(deleted, []);
  assert.deepEqual(await cleanupProfileImages(storage, repository, { apply: true, cutoff }),
    { apply: true, candidates: 1, removed: 1, failed: 0 });
  assert.deepEqual(deleted, [orphan]);
});
