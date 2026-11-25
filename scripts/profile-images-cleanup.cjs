require("./register-project-typescript.cjs");
require("@next/env").loadEnvConfig(process.cwd());
const { parseProfileImageKey } = require("../src/server/auth/profile");
const { openProfileStorage } = require("../src/server/auth/profile-storage");
const { openAuthRepository } = require("../src/server/auth/repository");
const { createTursoClient } = require("../src/server/g2b/repository/turso-client");

/**
 * 관리되는 프로필 이미지 중 하루 이상 지난 미참조 파일을 확인하고 선택적으로 삭제한다.
 * @returns {Promise<void>} 검사·삭제 건수를 출력한 뒤 완료한다.
 * @throws DB나 버킷에 연결할 수 없거나 일부 삭제가 실패한 경우.
 */
async function main() {
  // 기본 실행은 검사이며 운영자가 명시한 경우에만 삭제한다.
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== "--apply")) throw new Error("사용법: npm run profile:cleanup -- [--apply]");
  const apply = args[0] === "--apply";
  // 작업 시작 후 만들어진 객체와 아직 저장 중일 수 있는 신규 객체는 제외한다.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const storage = openProfileStorage();
  const client = createTursoClient();
  const repository = openAuthRepository(client);
  let candidates = 0;
  let removed = 0;
  let failed = 0;
  try {
    // 오래된 객체의 소유자 한 건만 기본 키로 확인해 현재 참조를 판별한다.
    for await (const { Key, LastModified } of storage.list()) {
      if (!Key || !LastModified || LastModified.getTime() > cutoff) continue;
      const parsed = parseProfileImageKey(Key);
      if (!parsed) continue;
      const owner = await repository.findUserState(parsed.owner);
      if (owner?.image === Key) continue;
      // 더 이상 재사용하지 않는 경로만 삭제 후보에 포함한다.
      candidates += 1;
      if (!apply) continue;
      try {
        // 다음 실행에서 실패 파일을 다시 찾을 수 있도록 버킷 목록을 기준으로 처리한다.
        await storage.remove(Key);
        removed += 1;
      } catch (error) {
        failed += 1;
        console.error("[프로필 객체 삭제]", error instanceof Error ? error.name : "UnknownError");
      }
    }
    // 객체 키, 저장소 주소 및 인증 정보 없이 집계만 출력한다.
    console.log(JSON.stringify({ apply, candidates, removed, failed }));
    if (failed) process.exitCode = 1;
  } finally {
    // 중간 조회 실패 시에도 연결을 닫고 남은 객체는 다음 실행에서 처리한다.
    client.close();
  }
}

/** 정리 명령의 실행 실패를 종료 코드로 알려 재시도할 수 있게 한다. */
main().catch((error) => {
  console.error("[프로필 이미지 정리]", error instanceof Error ? error.name : "UnknownError");
  process.exitCode = 1;
});
