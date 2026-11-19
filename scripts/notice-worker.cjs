require('./register-project-typescript.cjs');
require('@next/env').loadEnvConfig(process.cwd());
const { getG2bDatabase } = require('../src/server/g2b/repository');
const { runNoticeWorker } = require('../src/features/collect-g2b/api/notice-worker');
const { logNoticeQueueError } = require('../src/features/collect-g2b/api/notice-queue-service');
const { dispatchPendingAttachments } = require('../src/features/download-g2b-attachment/server/attachment-actions');
const { dispatchG2bWorkflow } = require('../src/server/g2b/github-workflow');

const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());

async function main() {
  const { client } = getG2bDatabase();
  try {
    // 같은 저장소의 main에서만 Actions 실행 토큰을 사용한다.
    const onCollected = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF === 'refs/heads/main' &&
      process.env.ATTACHMENT_PROGRESS_GITHUB_TOKEN
      ? () => dispatchPendingAttachments(() => dispatchG2bWorkflow('attachment-processing.yml', {
          repository: process.env.GITHUB_REPOSITORY,
          ref: 'main',
          credential: process.env.ATTACHMENT_PROGRESS_GITHUB_TOKEN,
        }))
      : undefined;
    await runNoticeWorker(stop.signal, undefined, undefined, { once: process.argv.includes('--once'), onCollected });
  } finally {
    client.close();
  }
}

main().catch((error) => {
  logNoticeQueueError('worker', error);
  process.exitCode = 1;
});
