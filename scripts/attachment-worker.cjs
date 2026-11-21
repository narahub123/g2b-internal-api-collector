require('./register-project-typescript.cjs');
require('@next/env').loadEnvConfig(process.cwd());
const { getG2bDatabase } = require('../src/server/g2b/repository');
const { runAttachmentWorker } = require('../src/features/download-g2b-attachment/server/attachment-worker');
const { assertAttachmentOcrReady } = require('./attachment-ocr-models.cjs');

const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());

// 첨부 워커만 종료하고 공고 수집 프로세스에는 신호를 보내지 않는다.
async function main() {
  // 환경이 제한된 추출 자식도 시작 검사와 정확히 같은 캐시를 읽는다.
  process.env.ATTACHMENT_MODEL_CACHE = await assertAttachmentOcrReady(stop.signal);
  const { client } = getG2bDatabase();
  try {
    await runAttachmentWorker(stop.signal, {
      once: process.argv.includes('--once'),
      reservation: process.env.ATTACHMENT_RESERVATION_TOKEN || undefined,
    });
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error('[첨부 워커 시작 실패]', error);
  process.exitCode = 1;
});
