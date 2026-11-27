// 실행 인자와 CLI 기준 기본 출력 경로를 처리한다.
const { resolve } = require('node:path');
const { parseArgs } = require('node:util');
// 기존 워커와 같은 TypeScript 로더로 서버 수집 함수를 실행한다.
require('./register-project-typescript.cjs');
const { runIndustryLawCollection, industryLawOutput } = require('../src/server/collections/industry-law.ts');
// CLI는 명령 실행 디렉터리와 관계없이 프로젝트의 기본 경로를 사용한다.
const defaultOutput = resolve(__dirname, '..', industryLawOutput);

/**
 * 단계 번호, 결과와 소요 시간만 공개한다.
 * @param {object} event 수집 함수가 전달한 단계별 진단.
 */
function logStep(event) {
  // 서버 응답 본문과 세션 값은 진단에 포함하지 않는다.
  const http = event.status ? ' HTTP ' + event.status : '';
  const duration = event.ms === undefined ? '' : ' ' + event.ms + 'ms';
  console.log(`[${event.step}] ${event.name} ${event.result}${http}${duration}`);
}

/**
 * 출력 인자를 읽고 로컬 수집을 실행해 결과와 종료 코드를 출력한다.
 * @returns {Promise<void>} 결과 출력과 종료 코드 설정이 끝난 상태.
 */
async function main() {
  // 전체 시간을 성공과 실패 모두에 표시한다.
  const start = performance.now();
  try {
    // 새 파일을 쓰는 실측과 기존 파일 재수집을 같은 명령으로 검증한다.
    const { values } = parseArgs({ options: { output: { type: 'string' } } });
    const summary = await runIndustryLawCollection({ output: values.output ?? defaultOutput, onStep: logStep });
    const labels = { created: '최초 저장', updated: '갱신', unchanged: '변경 없음' };
    console.log(`${labels[summary.status]} | lastUpdate ${summary.lastUpdate} | ${summary.totalRows}행 | 업종코드 ${summary.codes}개 | 다운로드 ${summary.bytes}바이트`);
  } catch (error) {
    // 실패는 호출자나 이후 작업이 구분할 수 있는 종료 코드로 전달한다.
    console.error('수집 실패 | ' + error.message);
    process.exitCode = 1;
  } finally {
    console.log('전체 실행 시간 ' + Math.round(performance.now() - start) + 'ms');
  }
}

// 테스트가 로컬 저장 함수를 불러올 때 CLI 실행은 시작하지 않는다.
if (require.main === module) void main();
