// 로컬 파일 교체와 HTTP 분기를 함께 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const Zip = require('adm-zip');
require('../scripts/register-project-typescript.cjs');
const { runLegalDistrictCollection: runCollection } = require('../src/server/collections/legal-districts.ts');

/**
 * 최초 저장과 날짜 갱신, 기간 경계, 실패 복구를 검증한다.
 */
async function verifyCollection() {
  // 테스트용 저장 공간과 응답 상태를 준비한다.
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'legal-districts-')));
  const output = join(directory, 'latest.json');
  const calls = [];
  // 수집 함수의 실제 JSON 읽기와 쓰기를 기록한다.
  const reads = [];
  const writes = [];
  const io = {
    ...fs,
    /**
     * 저장 계층에서 읽는 경로를 기록한다.
     * @param {string} path 읽을 파일.
     * @param {string} encoding 파일 인코딩.
     * @returns {Promise<string>} 파일 내용.
     */
    readFile(path, encoding) {
      reads.push(path);
      return fs.readFile(path, encoding);
    },
    /**
     * 저장 계층에서 쓰는 파일의 용도를 기록한다.
     * @param {string} path 쓸 파일.
     * @param {string} content 직렬화한 목록이나 메타데이터.
     * @param {object} options 파일 생성과 기록 옵션.
     * @returns {Promise<void>} 기록 완료.
     */
    writeFile(path, content, options) {
      writes.push(content.startsWith('[') ? 'rows' : 'metadata');
      return fs.writeFile(path, content, options);
    },
  };
  let count = 0;
  let fault;
  let code = '0000000001';

  /**
   * 요청 조건을 반영한 HTML 또는 ZIP을 생성한다.
   * @param {URL} url 조회 또는 다운로드 주소.
   * @param {RequestInit} init 조회 조건을 담은 요청.
   * @returns {Promise<Response>} 모의 사이트 응답.
   */
  async function fetchImpl(url, init) {
    // 다운로드와 기간 조회는 서로 다른 폼을 사용한다.
    if (url.pathname.endsWith('codeFullDown.do')) {
      calls.push('download');
      assert.equal(init.body.get('codeseId'), '법정동코드');
      assert.equal(init.body.get('disuseAt'), '0');
      if (fault === 'zip') return new Response('오류');
      // 실제 CP949로 인코딩한 한글 헤더와 상태를 제공한다.
      const zip = new Zip();
      const header = 'b9fdc1a4b5bfc4dab5e509b9fdc1a4b5bfb8ed09c6f3c1f6bfa9bace0d0a';
      const status = fault === 'txt' ? 'invalid' : '\xc1\xb8\xc0\xe7';
      // 코드명과 상태의 CP949 바이트를 헤더 뒤에 붙인다.
      zip.addFile('codes.txt', Buffer.concat([Buffer.from(header, 'hex'), Buffer.from(code + '\t', 'ascii'),
        Buffer.from('bcadbfef09', 'hex'), Buffer.from(status, 'latin1')]));
      return new Response(zip.toBuffer());
    }
    // 날짜와 선택값을 반환하되 지정한 오류만 주입한다.
    const start = init.body.get('stdate');
    const end = init.body.get('enddate');
    calls.push([start, end]);
    assert.equal(init.body.get('disuseAt'), 'ALL');
    return new Response(`<input name="stdate" value="${fault === 'start' ? '2000-01-01' : start}">
      <input name="enddate" value="${fault === 'end' ? '2000-01-01' : end}">
      <input type="radio" name="disuseAt" value="ALL" ${fault === 'status' ? '' : 'checked'}>
      <input type="radio" name="disuseAt" value="0" ${fault === 'status' ? 'checked' : ''}>
      <script>
        ${fault === 'count' ? '' : 'function func_modi() { var cnt = ' + count + '; }'}
        function func_want() { var cnt = document.form.chkWantCnt.value; }
      </script>`);
  }

  /**
   * 지정한 한국 날짜의 실행을 재현한다.
   * @param {string} date 실행 요청 날짜.
   * @param {object} options 실패 주입 설정.
   * @returns {Promise<object>} 수집 결과.
   */
  function run(date, options = {}) {
    return runCollection({ output, now: new Date(date + 'T00:01:00+09:00'), fetchImpl, io, ...options });
  }

  try {
    // 최초 다운로드 뒤 날짜만 바뀌는 장기 조회를 확인한다.
    assert.equal((await run('2024-02-29')).status, 'created');
    assert.deepEqual(calls.splice(0), ['download']);
    const first = JSON.parse(await fs.readFile(output, 'utf8'));
    const firstRows = JSON.parse(await fs.readFile(join(directory, first.listFile), 'utf8'));
    assert.deepEqual(firstRows[0], { code, name: '서울', status: '존재' });
    reads.length = writes.length = 0;
    assert.equal((await run('2025-03-01')).status, 'unchanged');
    assert.deepEqual(calls.splice(0), [['2024-02-29', '2025-02-28'], ['2025-02-28', '2025-03-01']]);
    const stored = await fs.readFile(output, 'utf8');
    assert.deepEqual(JSON.parse(stored), { ...first, lastSuccessfulDate: '2025-03-01' });
    assert.deepEqual(reads, [output]);
    assert.deepEqual(writes, ['metadata']);
    reads.length = writes.length = 0;
    await run('2025-03-01');
    assert.deepEqual(calls.splice(0), [['2025-03-01', '2025-03-01']]);
    assert.deepEqual(reads, [output]);
    assert.deepEqual(writes, []);
    // 조회 검증과 변환 오류 후 파일 바이트가 유지되어야 한다.
    for (const value of ['start', 'end', 'status', 'count', 'zip', 'txt']) {
      fault = value;
      count = ['zip', 'txt'].includes(value) ? 1 : 0;
      await assert.rejects(run('2025-03-02'));
      assert.equal(await fs.readFile(output, 'utf8'), stored);
    }
    fault = undefined;
    count = 0;
    // 변경 없음 경로에서도 교체가 실패하면 성공일을 보존한다.
    await assert.rejects(run('2025-03-02', { rename: async () => { throw Error('모의 저장 실패'); } }), /모의 저장 실패/);
    assert.equal(await fs.readFile(output, 'utf8'), stored);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['latest.json', first.listFile].sort());
    // 양수 결과에서는 기존 행과 성공일을 함께 교체한다.
    count = 1;
    code = '0000000002';
    assert.equal((await run('2025-03-02')).status, 'updated');
    const latest = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(latest.lastSuccessfulDate, '2025-03-02');
    assert.equal(JSON.parse(await fs.readFile(join(directory, latest.listFile), 'utf8'))[0].code, code);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['latest.json', latest.listFile].sort());
    // 기존 형식의 전환이 실패하면 이전 단일 파일이 그대로 남는다.
    const legacy = JSON.stringify({ lastSuccessfulDate: '2025-03-02', rows: firstRows });
    await fs.writeFile(output, legacy);
    count = 0;
    await assert.rejects(run('2025-03-02', { rename: async () => { throw Error('전환 실패'); } }), /전환 실패/);
    assert.equal(await fs.readFile(output, 'utf8'), legacy);
    assert.equal((await run('2025-03-02')).status, 'unchanged');
    const migrated = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(migrated.lastSuccessfulDate, '2025-03-02');
    assert.deepEqual(JSON.parse(await fs.readFile(join(directory, migrated.listFile), 'utf8')), firstRows);
    // 잠금이 있거나 참조 목록이 없으면 수집을 시작하지 않는다.
    await fs.writeFile(output + '.lock', '');
    await assert.rejects(run('2025-03-02'), /수집 잠금/);
    await fs.unlink(output + '.lock');
    await fs.unlink(join(directory, migrated.listFile));
    await assert.rejects(run('2025-03-02'), { code: 'ENOENT' });
  } finally {
    // 이번 테스트가 생성한 파일만 정리한다.
    for (const name of await fs.readdir(directory)) await fs.unlink(join(directory, name));
    await fs.rmdir(directory);
  }
}

// 전체 수집과 실패 복구를 한 흐름에서 확인한다.
test('법정동코드 최초 수집, 기간 확인 및 원자적 교체', verifyCollection);
