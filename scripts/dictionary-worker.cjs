// 운영 러너와 로컬 검증이 같은 서버 워커 진입점을 사용한다.
require("./register-project-typescript.cjs");
require("@next/env").loadEnvConfig(process.cwd());
const { runDictionaryWorker } = require("../src/server/collections/dictionary-worker.ts");
// 종료 신호는 새 작업 선점과 재시도 대기를 중단한다.
const stopping = new AbortController();
process.once("SIGTERM", () => stopping.abort());
process.once("SIGINT", () => stopping.abort());
void runDictionaryWorker({ signal: stopping.signal }).then((hadFailure) => {
  if (hadFailure) process.exitCode = 1;
}).catch((error) => {
  console.error("[사전 수집 워커]", error);
  process.exitCode = 1;
});
