// 기존 워커와 같은 로더를 사용해 수집 모듈을 실행한다.
require('./register-project-typescript.cjs');
const { resolve } = require('node:path');
// 두 수집 CLI에서 같은 잠금과 파일 교체를 사용한다.
const { withCollectionStore } = require('./local-collection-store.cjs');
const { parseArgs } = require('node:util');
// 조회와 변환은 로컬 파일 처리와 분리한다.
const { collectLegalDistricts, isDate, koreanDate } = require('../src/shared/api/code/legal-districts-collection.ts');
// 실행한 작업 디렉터리와 독립적인 기본 로컬 저장 경로다.
const defaultOutput = resolve(__dirname, '../.data/code/legal-districts.json');

/**
 * 지역 목록의 성공일과 상태별 집계를 검증한다.
 * @param {object} data 저장된 메타데이터.
 * @returns {boolean} 비교와 진단에 사용할 수 있는지 여부.
 */
function validate(data) {
  return isDate(data.lastSuccessfulDate) && data.total > 0 &&
    [data.total, data.active, data.abolished].every(Number.isSafeInteger) &&
    data.active >= 0 && data.abolished >= 0 && data.active + data.abolished === data.total;
}

/**
 * 이전 단일 파일의 행과 날짜로 메타데이터를 계산한다.
 * @param {object} snapshot 이전 형식의 저장본.
 * @returns {object} 이전에 적용된 날짜와 집계.
 * @throws 날짜나 행의 형식이 잘못된 경우.
 */
function migrate(snapshot) {
  // 전환 중 한 번의 순회로 행을 검사하고 상태별 건수를 센다.
  const codes = new Set();
  let active = 0;
  for (const row of snapshot.rows) {
    if (typeof row?.code !== 'string' || !/^\d{10}$/.test(row.code) || codes.has(row.code) ||
        typeof row.name !== 'string' || !row.name.trim() ||
        (row.status !== '존재' && row.status !== '폐지')) throw new Error('기존 법정동코드 행 형식 오류');
    codes.add(row.code);
    if (row.status === '존재') active++;
  }
  const total = snapshot.rows.length;
  const metadata = { lastSuccessfulDate: snapshot.lastSuccessfulDate, total, active, abolished: total - active };
  if (!validate(metadata)) throw new Error('기존 법정동코드 JSON 형식 오류');
  return metadata;
}

/**
 * 이전 성공일부터 원본을 확인하고 새 목록 또는 성공일을 적용한다.
 * @param {object} [options] 출력, 시각, 네트워크 및 저장 설정.
 * @returns {Promise<object>} 적용 분기와 날짜, 건수.
 * @throws 조회나 저장에 실패하거나 출력이 잠겼을 때.
 */
async function runCollection({ output = defaultOutput, now = new Date(), fetchImpl, onProgress, rename, io } = {}) {
  // 모든 구간에 시작 시점의 한국 날짜를 사용한다.
  const requestDate = koreanDate(now);
  return withCollectionStore({ output, validate, migrate, io, rename }, collect);

  /**
   * 현재 성공일과 건수만 사용해 원본 확인과 결과 적용을 수행한다.
   * @param {object|undefined} previous 현재 적용된 메타데이터.
   * @param {Function} save 메타데이터와 선택적인 목록을 적용하는 함수.
   * @returns {Promise<object>} 실행 결과와 출력용 건수.
   */
  async function collect(previous, save) {
    const downloaded = await collectLegalDistricts({ previousDate: previous?.lastSuccessfulDate, requestDate, fetchImpl, onProgress });
    // 다운로드를 생략하면 기존 목록을 열지 않고 집계값도 재사용한다.
    const { total, active, abolished } = downloaded ?? previous;
    if (downloaded || previous.lastSuccessfulDate !== requestDate) {
      await save({ lastSuccessfulDate: requestDate, total, active, abolished }, downloaded?.rows);
    }
    return { status: previous ? (downloaded ? 'updated' : 'unchanged') : 'created', requestDate, total, active, abolished };
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
module.exports = { runCollection };
