require('./register-project-typescript.cjs');
const { runNoticeWorker } = require('../src/features/collect-g2b/api/notice-worker');
const { logNoticeQueueError } = require('../src/features/collect-g2b/api/notice-queue-service');

const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());

runNoticeWorker(stop.signal).catch((error) => {
  logNoticeQueueError('worker-start-or-recover', error);
  process.exitCode = 1;
});
