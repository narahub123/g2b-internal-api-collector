require('./register-project-typescript.cjs');
require('@next/env').loadEnvConfig(process.cwd());
const { getG2bDatabase } = require('../src/server/g2b/repository');
const { runAttachmentWorker } = require('../src/features/download-g2b-attachment/server/attachment-worker');

const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());

// 첨부 워커만 종료하고 공고 수집 프로세스에는 신호를 보내지 않는다.
async function main() {
  const { client } = getG2bDatabase();
  try {
    await runAttachmentWorker(stop.signal, { once: process.argv.includes('--once') });
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error('[첨부 워커 시작 실패]', error);
  process.exitCode = 1;
});
