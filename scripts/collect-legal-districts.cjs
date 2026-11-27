// 실행 인자와 CLI 기준 기본 출력 경로를 처리한다.
const { resolve } = require('node:path');
const { parseArgs } = require('node:util');
// 기존 워커와 같은 TypeScript 로더로 서버 수집 함수를 실행한다.
require('./register-project-typescript.cjs');
const { runLegalDistrictCollection, legalDistrictOutput } = require('../src/server/collections/legal-districts.ts');
// CLI는 명령 실행 디렉터리와 관계없이 프로젝트의 기본 경로를 사용한다.
const defaultOutput = resolve(__dirname, '..', legalDistrictOutput);

/**
 * 검증된 조회 조건과 다운로드 크기를 출력한다.
 * @param {object} event 완료된 요청의 진단 정보.
 */
function logProgress(event) {
  // 최초 수집에서 기간 이벤트는 없고 0건에서는 다운로드 이벤트가 없다.
  if (event.period) {
    console.log(`변경 조회 ${event.period.start} ~ ${event.period.end} | 조건 일치(전체) | ${event.count}건`);
  } else {
    console.log(`ZIP 다운로드 및 TXT 검증 완료 | ${event.bytes}바이트`);
  }
}

/**
 * 실행 인자를 읽고 수집 결과 및 종료 상태를 출력한다.
 * @returns {Promise<void>} 수집 또는 실패가 최종 보고된 상태.
 */
async function main() {
  // 성공과 실패 모두 소요 시간을 기록한다.
  const started = performance.now();
  try {
    const { values } = parseArgs({ options: { output: { type: 'string' } } });
    const summary = await runLegalDistrictCollection({ output: values.output ?? defaultOutput, onProgress: logProgress });
    const labels = { created: '최초 저장', updated: '전체자료 갱신', unchanged: '변경 없음, 다운로드 생략' };
    console.log(`${labels[summary.status]} | ${summary.requestDate} | 전체 ${summary.total}건 | 존재 ${summary.active}건 | 폐지 ${summary.abolished}건`);
  } catch (error) {
    console.error('수집 실패 | ' + error.message);
    process.exitCode = 1;
  } finally {
    console.log('전체 실행 시간 ' + Math.round(performance.now() - started) + 'ms');
  }
}

// 회귀 테스트에서 함수를 불러올 때는 CLI를 실행하지 않는다.
if (require.main === module) void main();
