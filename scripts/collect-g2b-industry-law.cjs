// 로컬 저장본과 같은 디렉터리에서 임시 파일을 관리한다.
const fs = require('node:fs/promises');
const { dirname, basename, resolve, join } = require('node:path');
// 실행 간 임시 파일 이름 충돌을 막는다.
const { randomUUID } = require('node:crypto');
// CLI 인자의 유효성을 확인한다.
const { parseArgs } = require('node:util');
// 기존 워커와 같은 로더로 TypeScript 수집 모듈을 실행한다.
require('./register-project-typescript.cjs');
// 네트워크 요청과 변환은 CLI 외부에서도 재사용한다.
const { collectIndustryLaw, reportId } = require('../src/shared/api/g2b/industry-law-collection.ts');

// 기본 로컬 저장 위치는 명령을 실행한 디렉터리와 독립적이다.
const defaultOutput = resolve(__dirname, '../.data/g2b/industry-law.json');

/**
 * 현재 파일을 읽고 이 보고서에 적용된 스냅샷인지 검증한다.
 * @param {string} output 현재 JSON 저장 경로.
 * @returns {Promise<object|undefined>} 저장본 또는 파일이 없을 때 undefined.
 * @throws 읽을 수 없거나 잘못된 저장본일 때.
 */
async function readSnapshot(output) {
  // 파일 부재만 최초 수집으로 취급한다.
  let content;
  try {
    content = await fs.readFile(output, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  // 파싱 오류에 포함될 수 있는 원본 문구는 출력하지 않는다.
  let snapshot;
  try {
    snapshot = JSON.parse(content);
  } catch {
    throw new Error('기존 저장본 JSON 형식 오류');
  }
  if (snapshot?.reportId !== reportId || typeof snapshot.lastUpdate !== 'string' ||
      !snapshot.lastUpdate.trim() || !Array.isArray(snapshot.rows)) {
    throw new Error('기존 저장본의 보고서 정보 또는 행 목록 오류');
  }
  return snapshot;
}

/**
 * 한 출력에 대한 실행권을 확보하고 검증된 새 스냅샷만 교체한다.
 * @param {object} [options] 출력 경로, 요청 및 검증 설정.
 * @param {string} [options.output] 스냅샷을 관리할 파일 경로.
 * @param {typeof fetch} [options.fetchImpl] HTTP 요청 함수.
 * @param {Function} [options.onStep] 진행 결과를 전달할 함수.
 * @param {typeof fs.rename} [options.rename] 파일 교체 함수.
 * @returns {Promise<object>} 수집 상태, 버전 및 건수와 다운로드 크기.
 * @throws 실행 중복, 요청·변환 오류 또는 저장 실패.
 */
async function runCollection({ output = defaultOutput, fetchImpl, onStep, rename = fs.rename } = {}) {
  // 디렉터리를 실제 경로로 통일해 별칭 경로에서 중복 실행을 방지한다.
  const path = resolve(output);
  await fs.mkdir(dirname(path), { recursive: true });
  const target = join(await fs.realpath(dirname(path)), basename(path));
  // 출력마다 배타적으로 생성되는 파일을 실행권으로 사용한다.
  const lockPath = target + '.lock';
  let lock;
  try {
    lock = await fs.open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('같은 출력 경로에 수집 잠금이 있습니다: ' + lockPath);
    throw error;
  }
  // 실패 시 정리할 이 실행의 임시 파일 이름이다.
  let temp;
  try {
    // 조회·비교·저장을 같은 실행권 아래에서 수행한다.
    const current = await readSnapshot(target);
    const collected = await collectIndustryLaw({
      appliedLastUpdate: current?.lastUpdate,
      fetchImpl,
      onStep,
    });
    // unchanged에서는 기존 배열의 고유 코드 수만 요약에 사용한다.
    const rows = collected.rows ?? current.rows;
    const codes = new Set();
    for (const row of rows) codes.add(row.industryCode);
    const summary = {
      status: collected.rows ? (current ? 'updated' : 'created') : 'unchanged',
      lastUpdate: collected.lastUpdate,
      totalRows: collected.totalRows,
      codes: codes.size,
      bytes: collected.bytes,
    };
    if (collected.rows) {
      // 버전과 데이터를 하나의 파일로 준비한 뒤 같은 디렉터리에서 교체한다.
      temp = target + '.' + randomUUID() + '.tmp';
      const snapshot = { reportId, lastUpdate: collected.lastUpdate, rows };
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', flush: true });
      await rename(temp, target);
      temp = undefined;
    }
    return summary;
  } finally {
    // 임시 저장 실패가 발생해도 실행권 해제를 시도한다.
    try {
      if (temp) await fs.rm(temp, { force: true });
    } finally {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
}

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
    const summary = await runCollection({ output: values.output, onStep: logStep });
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
module.exports = { runCollection };
