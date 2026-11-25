const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createClient } = require("@libsql/client");
const sharp = require("sharp");
require("../scripts/register-project-typescript.cjs");

/** 사진을 검증하고 투명도를 유지한 작은 WebP로 변환하는지 확인한다. */
test("프로필 사진을 최대 512px WebP로 변환하고 지원하지 않는 입력을 거절한다", async () => {
  // 모바일 사진 크기의 투명 PNG를 실제 인코더 테스트에 사용한다.
  const { encodeProfileImage, ProfileInputError } = require("../src/server/auth/profile");
  const png = await sharp({
    create: { width: 3024, height: 4032, channels: 4, background: { r: 60, g: 80, b: 100, alpha: 0.5 } },
  }).png().toBuffer();
  // 변환 결과의 실제 형식, 크기, 투명도를 다시 디코딩해서 확인한다.
  const result = await encodeProfileImage(png);
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.height, 512);
  assert.equal(metadata.hasAlpha, true);
  assert.ok(result.length <= 256 * 1024);
  // 깨진 파일과 업로드 한도를 넘는 파일은 오류로 처리한다.
  await assert.rejects(encodeProfileImage(Buffer.from("broken")), ProfileInputError);
  await assert.rejects(encodeProfileImage(Buffer.alloc(4 * 1024 * 1024 + 1)), ProfileInputError);
});

/** 실제 DB와 메모리 객체 저장소의 교체 및 실패 경계를 검증한다. */
test("파일 교체 충돌과 인프라 실패가 현재 이미지 참조를 끊지 않는다", async () => {
  // 같은 내부 사용자와 기존 파일을 격리 DB에 준비한다.
  const { migrateG2bDatabase } = require("../src/server/g2b/repository/migrations");
  const { openAuthRepository } = require("../src/server/auth/repository");
  const { saveProfile, parseProfileImageKey, profileImageUrl } = require("../src/server/auth/profile");
  const client = createClient({ url: "file::memory:" });
  const repository = openAuthRepository(client);
  const userId = "profile-user";
  const previousImage = `profile-images/${Buffer.from(userId).toString("base64url")}/11111111-1111-1111-1111-111111111111.webp`;
  const file = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#336699" } }).jpeg().toBuffer();
  // 파일 목록은 업로드와 삭제 실패 뒤 참조가 실제 남는지 확인하는 데 사용한다.
  const objects = new Set([previousImage]);
  let rejectPut = false;
  let rejectRemove = false;
  const storage = {
    /** 성공한 업로드만 메모리 저장소에 기록한다. */
    async put(key) {
      if (rejectPut) throw new Error("upload failure");
      objects.add(key);
    },
    /** 실패를 설정한 경우 기존 파일을 남겨 나중에 정리할 수 있게 한다. */
    async remove(key) {
      if (rejectRemove) throw new Error("delete failure");
      objects.delete(key);
    },
  };
  /** 같은 객체 목록을 사용하는 테스트 저장소를 반환한다. */
  const storageFactory = () => storage;
  try {
    // 실제 마이그레이션이 적용된 저장소를 사용한다.
    await migrateG2bDatabase(client);
    await client.execute({ sql: "INSERT INTO auth_users (id, email, nickname, image) VALUES (?, ?, ?, ?)",
      args: [userId, "test@example.test", "처음", previousImage] });
    const original = { userId, previousImage, nickname: " 새 이름 ", file };

    // 업로드 실패는 DB에 쓰지 않고 이전 파일을 유지한다.
    rejectPut = true;
    await assert.rejects(saveProfile(repository, storageFactory, original), /upload failure/);
    assert.equal((await repository.findUserState(userId)).image, previousImage);
    rejectPut = false;

    // 같은 기존 경로에서 시작한 두 요청 중 하나만 저장되고 실패 측 파일은 정리된다.
    const results = await Promise.all([
      saveProfile(repository, storageFactory, original), saveProfile(repository, storageFactory, original),
    ]);
    assert.deepEqual(results.sort(), [false, true]);
    const latest = await repository.findUserState(userId);
    assert.equal(latest.nickname, "새 이름");
    assert.deepEqual([...objects], [latest.image]);
    assert.equal(parseProfileImageKey(latest.image).owner, userId);
    assert.notEqual(profileImageUrl(previousImage), profileImageUrl(latest.image));
    assert.equal(profileImageUrl("https://example.test/profile.png"), "https://example.test/profile.png");

    // 저장 결과가 불확실하면 실제로 커밋된 새 파일을 지우지 않는다.
    const ambiguous = {
      /** DB가 갱신한 뒤 응답이 끊긴 상황을 재현한다. */
      async updateProfile(...args) {
        await repository.updateProfile(...args);
        throw new Error("response lost");
      },
    };
    await assert.rejects(saveProfile(ambiguous, storageFactory, { ...original, previousImage: latest.image }), /response lost/);
    const committed = await repository.findUserState(userId);
    assert.notEqual(committed.image, latest.image);
    assert.ok(objects.has(committed.image));

    // 이전 객체 삭제가 실패하더라도 새 프로필은 저장 성공으로 유지된다.
    rejectRemove = true;
    assert.equal(await saveProfile(repository, storageFactory, { ...original, previousImage: committed.image }), true);
    const finalState = await repository.findUserState(userId);
    assert.ok(objects.has(finalState.image) && objects.has(committed.image));
    assert.notEqual(finalState.image, committed.image);

    // 닉네임만 저장할 때는 R2와 무관하게 현재 이미지 경로를 유지한다.
    assert.equal(await saveProfile(repository, () => { throw new Error("unexpected storage access"); },
      { userId, previousImage, nickname: "이름만 변경" }), true);
    assert.equal((await repository.findUserState(userId)).image, finalState.image);
  } finally {
    // 시나리오 실행에 사용한 DB 연결을 닫는다.
    client.close();
  }
});
