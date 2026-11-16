require('./register-project-typescript.cjs');
require('@next/env').loadEnvConfig(process.cwd());
const { getG2bDatabase } = require('../src/server/g2b/repository');
const { runNoticeWorker } = require('../src/features/collect-g2b/api/notice-worker');
const { logNoticeQueueError } = require('../src/features/collect-g2b/api/notice-queue-service');

const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());

async function main() {
  const { client } = getG2bDatabase();
  try {
    await runNoticeWorker(stop.signal);
  } finally {
    client.close();
  }
}

main().catch((error) => {
  logNoticeQueueError('worker', error);
  process.exitCode = 1;
});
