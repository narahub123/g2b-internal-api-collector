const { execFile } = require("node:child_process");
const { homedir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { promisify } = require("node:util");

/** 모델 경로를 절대 경로로 고정하고, 준비 명령에서만 다운로드를 허용한다. */
function configureAttachmentOcr(allowDownload = false) {
  const cache = resolve(process.env.ATTACHMENT_MODEL_CACHE?.trim() || join(homedir(), ".cache", "kordoc", "models"));
  process.env.KORDOC_MODEL_CACHE = cache;
  process.env.KORDOC_OFFLINE = allowDownload ? "0" : "1";
  return cache;
}

/**
 * 설치된 파서의 모델 검사로 세 파일의 존재 여부와 체크섬을 확인한다.
 * @throws 모델이 준비되지 않았거나 검사 프로세스가 정상 종료하지 않으면 워커 시작을 중단한다.
 */
async function assertAttachmentOcrReady(signal) {
  const cache = configureAttachmentOcr();
  const { stdout } = await promisify(execFile)(process.execPath, [cliPath(), "check-ocr-models", "--status-only"], {
    signal, windowsHide: true,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      KORDOC_MODEL_CACHE: cache, KORDOC_OFFLINE: "1" },
  });
  const status = JSON.parse(stdout);
  if (status.allReady !== true) {
    throw new Error(`OCR 모델을 준비해야 합니다. 캐시: ${status.modelsDir}. npm run attachments:ocr:prepare 실행 후 워커를 다시 시작하세요.`);
  }
  return cache;
}

function cliPath() {
  return join(dirname(require.resolve("kordoc")), "cli.js");
}

if (require.main === module) {
  require("@next/env").loadEnvConfig(process.cwd());
  configureAttachmentOcr(true);
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(process.execPath, [cliPath(), "check-ocr-models"], { stdio: "inherit" });
  if (result.error) console.error("[OCR 모델 준비 실패]", result.error.message);
  process.exitCode = result.status ?? 1;
}

module.exports = { configureAttachmentOcr, assertAttachmentOcrReady };
