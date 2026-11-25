require("./register-project-typescript.cjs");
const { parseProfileImageKey } = require("../src/server/auth/profile");
const { openProfileStorage } = require("../src/server/auth/profile-storage");
const { openAuthRepository } = require("../src/server/auth/repository");
const { createTursoClient } = require("../src/server/g2b/repository/turso-client");

/**
 * 관리되는 프로필 이미지 중 하루 이상 지난 미참조 파일을 확인하고 선택적으로 삭제한다.
 * @param {object} storage Cloudinary 목록 조회와 삭제를 제공하는 저장소.
 * @param {object} repository 현재 사용자 이미지 경로를 읽는 저장소.
 * @param {object} options 실제 삭제 여부와 대상 생성 시각의 상한.
 * @returns {Promise<object>} 삭제 후보·성공·실패 건수.
 * @throws 현재 DB 참조나 Cloudinary 목록을 확인할 수 없는 경우.
 */
async function cleanupProfileImages(storage, repository, { apply, cutoff }) {
  // 실행 모드와 함께 반환할 검사 결과를 집계한다.
  let candidates = 0;
  let removed = 0;
  let failed = 0;
  // 오래된 객체의 소유자 한 건만 기본 키로 확인해 현재 참조를 판별한다.
  for await (const { key, createdAt } of storage.list()) {
    if (createdAt.getTime() > cutoff) continue;
    const parsed = parseProfileImageKey(key);
    if (!parsed) continue;
    const owner = await repository.findUserState(parsed.owner);
    if (owner?.image === key) continue;
    // 더 이상 재사용하지 않는 경로만 삭제 후보에 포함한다.
    candidates += 1;
    if (!apply) continue;
    try {
      // 다음 실행에서 실패 파일을 다시 찾을 수 있도록 공급자 목록을 기준으로 처리한다.
      await storage.remove(key);
      removed += 1;
    } catch (error) {
      failed += 1;
      console.error("[프로필 객체 삭제]", error instanceof Error ? error.name : "UnknownError");
    }
  }
  // 명령은 객체 식별자를 포함하지 않는 집계만 출력한다.
  return { apply, candidates, removed, failed };
}

/**
 * 운영 설정을 읽고 미리보기 또는 명시적인 실제 삭제를 한 번 실행한다.
 * @throws 명령줄 또는 공급자 설정이 잘못된 경우.
 */
async function main() {
  // 기본 실행은 검사이며 운영자가 명시한 경우에만 삭제한다.
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== "--apply")) throw new Error("사용법: npm run profile:cleanup -- [--apply]");
  const apply = args[0] === "--apply";
  // 작업 시작 시점을 기준으로 24시간을 계산하고 애플리케이션 환경을 로드한다.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  require("@next/env").loadEnvConfig(process.cwd());
  const storage = openProfileStorage();
  const client = createTursoClient();
  try {
    // 같은 DB 연결로 자산의 현재 참조 여부를 확인한다.
    const result = await cleanupProfileImages(storage, openAuthRepository(client), { apply, cutoff });
    // 객체 키, 저장소 주소 및 인증 정보 없이 집계만 출력한다.
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } finally {
    // 중간 조회 실패 시에도 연결을 닫고 남은 객체는 다음 실행에서 처리한다.
    client.close();
  }
}

/** 정리 명령의 실행 실패를 종료 코드로 알려 재시도할 수 있게 한다. */
if (require.main === module) main().catch((error) => {
  console.error("[프로필 이미지 정리]", error instanceof Error ? error.name : "UnknownError");
  process.exitCode = 1;
});

// 독립 검증에서는 실제 공급자 연결 없이 동일한 정리 절차를 실행한다.
module.exports = { cleanupProfileImages };
