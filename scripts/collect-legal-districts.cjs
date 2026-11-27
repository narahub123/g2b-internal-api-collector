// 기존 워커와 같은 로더를 사용해 수집 모듈을 실행한다.
require('./register-project-typescript.cjs');
// 스냅샷을 같은 디렉터리의 임시 파일을 통해 교체한다.
const fs = require('node:fs/promises');
const { dirname, basename, resolve, join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseArgs } = require('node:util');
// 조회와 변환은 로컬 파일 처리와 분리한다.
const { collectLegalDistricts, isDate, koreanDate } = require('../src/shared/api/code/legal-districts-collection.ts');
// 실행한 작업 디렉터리와 독립적인 기본 로컬 저장 경로다.
const defaultOutput = resolve(__dirname, '../.data/code/legal-districts.json');

/**
 * 이전 스냅샷과 성공일을 읽고 갱신 여부를 판단할 수 있는지 검증한다.
 * @param {string} output 스냅샷 경로.
 * @returns {Promise<object|undefined>} 기존 자료 또는 최초 수집을 뜻하는 undefined.
 * @throws 파일이 존재하지만 읽을 수 없거나 형식이 잘못된 경우.
 */
async function readSnapshot(output) {
  // 파일이 없는 경우에만 최초 수집으로 처리한다.
  let content;
  try {
    content = await fs.readFile(output, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  // 저장된 날짜와 행 목록이 모두 있어야 기간 조회에 사용할 수 있다.
  const snapshot = JSON.parse(content);
  if (!isDate(snapshot?.lastSuccessfulDate) || !Array.isArray(snapshot.rows) || !snapshot.rows.length) {
    throw new Error('기존 법정동코드 JSON 형식 오류');
  }
  return snapshot;
}

/**
 * 용도별 출력 경로에 실행권을 확보하고 성공한 결과만 교체한다.
 * @param {object} [options] 실행 시각, 출력 경로, 요청 및 교체 함수.
 * @returns {Promise<object>} 수집 분기와 적용 날짜 및 상태별 건수.
 * @throws 중복 실행 또는 조회·변환·저장 실패.
 */
async function runCollection({ output = defaultOutput, now = new Date(), fetchImpl, onProgress, rename = fs.rename } = {}) {
  // 시작 시점의 한국 날짜를 이번 실행 전체에 적용한다.
  const requestDate = koreanDate(now);
  const path = resolve(output);
  await fs.mkdir(dirname(path), { recursive: true });
  const target = join(await fs.realpath(dirname(path)), basename(path));
  // 동일 출력에 대해 조회와 교체 전체를 한 실행에 맡긴다.
  const lockPath = target + '.lock';
  let lock;
  try {
    lock = await fs.open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('같은 출력 경로에 수집 잠금이 있습니다: ' + lockPath);
    throw error;
  }
  // 실패 후에도 정리할 수 있도록 이 실행의 임시 파일을 추적한다.
  let temp;
  try {
    // 조회에서 0건을 반환하면 기존 행과 새 날짜를 함께 기록한다.
    const previous = await readSnapshot(target);
    const downloaded = await collectLegalDistricts({ previousDate: previous?.lastSuccessfulDate, requestDate, fetchImpl, onProgress });
    const rows = downloaded ?? previous.rows;
    const snapshot = { lastSuccessfulDate: requestDate, rows };
    // 임시 파일을 완전히 기록한 뒤 같은 디렉터리에서 원자적으로 교체한다.
    temp = target + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', flush: true });
    await rename(temp, target);
    temp = undefined;
    // 운영자가 고유 상태별 건수와 다운로드 분기를 확인할 수 있게 한다.
    let active = 0;
    for (const row of rows) if (row?.status === '존재') active++;
    return {
      status: previous ? (downloaded ? 'updated' : 'unchanged') : 'created',
      requestDate, total: rows.length, active, abolished: rows.length - active,
    };
  } finally {
    // 저장 실패와 관계없이 임시 파일과 배타 실행권을 정리한다.
    try {
      if (temp) await fs.rm(temp, { force: true });
    } finally {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
}

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
    const summary = await runCollection({ output: values.output, onProgress: logProgress });
    const labels = { created: '최초 저장', updated: '전체자료 갱신', unchanged: '변경 없음, 다운로드 생략 및 성공일 갱신' };
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
module.exports = { runCollection };
