const { resolve } = require('node:path');
// 두 수집 CLI에서 같은 잠금과 파일 교체를 사용한다.
const { withCollectionStore } = require('./local-collection-store.cjs');
const { parseArgs } = require('node:util');
// 기존 워커와 같은 로더로 TypeScript 수집 모듈을 실행한다.
require('./register-project-typescript.cjs');
// 네트워크 요청과 변환은 CLI 외부에서도 재사용한다.
const { collectIndustryLaw, reportId } = require('../src/shared/api/g2b/industry-law-collection.ts');

// 기본 로컬 저장 위치는 명령을 실행한 디렉터리와 독립적이다.
const defaultOutput = resolve(__dirname, '../.data/g2b/industry-law.json');

/**
 * 업종 보고서 식별자, 수정 기준과 집계를 검증한다.
 * @param {object} data 저장된 메타데이터.
 * @returns {boolean} 비교와 진단에 사용할 수 있는지 여부.
 */
function validate(data) {
  return data.reportId === reportId && typeof data.lastUpdate === 'string' && Boolean(data.lastUpdate.trim()) &&
    Number.isSafeInteger(data.totalRows) && data.totalRows > 0 &&
    Number.isSafeInteger(data.codes) && data.codes > 0 && data.codes <= data.totalRows;
}

/**
 * 단일 파일에 저장된 업종 목록에서 메타데이터를 계산한다.
 * @param {object} snapshot 이전 형식의 저장본.
 * @returns {object} 이전에 적용된 수정 기준과 집계.
 * @throws 원본 형식이 올바르지 않은 경우.
 */
function migrate(snapshot) {
  // 전환 시 기존 행은 그대로 보존하고 출력에 필요한 코드만 집계한다.
  const codes = new Set();
  for (const row of snapshot.rows) {
    if (typeof row?.industryCode !== 'string' || !row.industryCode.trim()) throw new Error('기존 업종코드 행 형식 오류');
    codes.add(row.industryCode);
  }
  const metadata = { reportId: snapshot.reportId, lastUpdate: snapshot.lastUpdate, totalRows: snapshot.rows.length, codes: codes.size };
  if (!validate(metadata)) throw new Error('기존 업종 저장본 형식 오류');
  return metadata;
}

/**
 * 저장된 수정 기준으로 보고서를 조회하고 바뀐 목록만 저장한다.
 * @param {object} [options] 출력 경로와 요청·저장 설정.
 * @returns {Promise<object>} 실행 분기와 업종 집계.
 * @throws 수집 또는 저장에 실패하거나 출력이 잠겼을 때.
 */
async function runCollection({ output = defaultOutput, fetchImpl, onStep, rename, io } = {}) {
  return withCollectionStore({ output, validate, migrate, rename, io }, collect);

  /**
   * 기존 기준과 조회 버전을 비교해 변경된 자료만 적용한다.
   * @param {object|undefined} current 기존 메타데이터.
   * @param {Function} save 새 메타데이터와 행을 적용하는 함수.
   * @returns {Promise<object>} 적용 분기와 진단 값.
   */
  async function collect(current, save) {
    const collected = await collectIndustryLaw({ appliedLastUpdate: current?.lastUpdate, fetchImpl, onStep });
    // 동일 버전에서는 기존 집계만 사용하며 저장을 생략한다.
    const metadata = collected.rows
      ? { reportId, lastUpdate: collected.lastUpdate, totalRows: collected.totalRows, codes: collected.codes }
      : current;
    if (collected.rows) await save(metadata, collected.rows);
    return {
      status: collected.rows ? (current ? 'updated' : 'created') : 'unchanged',
      lastUpdate: metadata.lastUpdate, totalRows: metadata.totalRows, codes: metadata.codes, bytes: collected.bytes,
    };
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
