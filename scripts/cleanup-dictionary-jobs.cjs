// 기존 시간별 정리와 같은 미리보기 플래그를 사용한다.
require("./register-project-typescript.cjs");
require("@next/env").loadEnvConfig(process.cwd());
const { getDictionaryQueue } = require("../src/server/collections/dictionary-queue.ts");

/** 실패 이력 없는 사전 성공 기록을 작은 배치로 정리한다. */
async function main() {
  const dryRun = process.env.NOTICE_CLEANUP_DRY_RUN !== "false";
  const count = await getDictionaryQueue().cleanup(dryRun);
  console.log(`사전 큐 · ${dryRun ? "삭제 후보(최대 100건)" : "삭제 완료"} ${count}건`);
}

void main().catch((error) => {
  console.error("[사전 큐 정리]", error);
  process.exitCode = 1;
});
