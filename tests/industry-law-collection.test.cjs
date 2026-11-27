// 수집에 사용되는 응답과 저장 실패를 실제 네트워크 없이 재현한다.
const test = require('node:test');
// 요청 순서와 저장 내용을 비교한다.
const assert = require('node:assert/strict');
// 임시 출력 경로를 준비하고 검증 후 정리한다.
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
// CLI와 같은 수집 및 저장 진입점을 검사한다.
const { runCollection } = require('../scripts/collect-g2b-industry-law.cjs');

/**
 * 쿠키·폼 전달과 CSV 왕복, 다운로드 생략, 실패 복구를 검증한다.
 */
async function verifyCollection() {
  // 실행 간에 실제 파일을 공유하되 운영 데이터와 분리한다.
  const directory = await fs.mkdtemp(join(tmpdir(), 'industry-law-'));
  // 저장 실패를 주입할 때도 같은 출력 경로를 사용한다.
  const output = join(directory, 'snapshot.json');
  // 새 버전과 잘못된 행 수를 각 실행에 주입한다.
  let version = '26-11-27 오후 1:1:2';
  let expectedRows = 2;
  let delimiter = ',';
  // 검색조건 요청의 HTTP 오류를 필요한 실행에서만 재현한다.
  let failPrompt = false;
  // HTTP 호출의 생략 및 순서를 비교한다.
  const calls = [];
  /**
   * 각 단계에 필요한 최소 응답을 반환한다.
   * @param {URL} url 요청 목적지.
   * @param {RequestInit} init 쿠키와 폼 전달을 확인할 요청 설정.
   * @returns {Promise<Response>} 해당 단계의 모의 응답.
   */
  async function fetchReport(url, init) {
    // 각 요청의 목적지를 순서대로 기록한다.
    calls.push(url.pathname);
    if (url.pathname.endsWith('/sso.jsp')) {
      // 새 세션은 빈 쿠키로 시작하며 SSO 쿠키를 후속 요청에 이어야 한다.
      assert.equal(init.headers.get('cookie'), null);
      return new Response('', { headers: { 'set-cookie': 'report=sample; Path=/' } });
    }
    // SSO 응답에서 받은 쿠키가 후속 요청에 들어있는지 확인한다.
    assert.equal(init.headers.get('cookie'), 'report=sample');
    if (url.pathname.endsWith('.json')) {
      // 검색조건 생성은 AJAX 요청으로 전송한다.
      assert.equal(init.headers.get('x-requested-with'), 'XMLHttpRequest');
      if (failPrompt) return new Response(null, { status: 503 });
      return Response.json({ errorCode: 'success', xml: '<prompt/>' });
    }
    if (url.pathname.endsWith('.csv')) {
      // 다운로드에는 준비 응답의 상태를 사용한다.
      assert.equal(init.body.get('rb'), 'export&rb');
      // 구분자와 줄바꿈을 포함한 규정 및 반복 행을 공급한다.
      const header = ['"업종분류"', '', '"업종"', '', '"근거법령"', '"관련규정내용"', '"사용여부"', '"제한업종"', '', '"허용업종"', ''];
      const row = ['01', '분류', '0001', '업종명', '법령', '"본문, 첫 줄\r\n둘째 줄"', 'Y', '', '', '', ''];
      const csv = ['보고서 안내', header.join(delimiter), row.join(delimiter), row.join(delimiter)].join('\r\n');
      return new Response(Buffer.from('\ufeff' + csv, 'utf16le'), { headers: { 'content-type': 'application/csv' } });
    }
    if (url.searchParams.has('name')) {
      // 반복 필드의 순서와 보고서 상태의 전달을 검증한다.
      assert.deepEqual(init.body.getAll('evt'), ['25002', '3131', '25003']);
      assert.equal(init.body.get('mstrWeb'), 'report&amp;state');
      return new Response('<form name="printForm"><input name="mstrWeb" value="export"><input name="rb" value="export&amp;rb"></form>');
    }
    // 검색조건 XML을 확인하고 현재 보고서 버전을 반환한다.
    assert.equal(init.body.get('promptsAnswerXML'), '<prompt/>');
    return new Response(`<title>UI-ADOBAA-001R.업종 및 근거법규 내역</title>
      <script>var state={'lastUpdate':'최근 수정: ${version}','ifTotalRows':${expectedRows}};</script>
      <form id="pageStateForm"><input value="report&amp;amp;state" name="mstrWeb"><input name="rb" value="report-rb"></form>`);
  }
  try {
    // 최초 수집에서 모든 요청이 진행되며 두 행이 유지된다.
    assert.equal((await runCollection({ output, fetchImpl: fetchReport })).status, 'created');
    assert.equal(calls.length, 5);
    const first = await fs.readFile(output, 'utf8');
    const snapshot = JSON.parse(first);
    assert.equal(snapshot.rows[0].industryCode, '0001');
    assert.equal(snapshot.rows[0].relatedRules, '본문, 첫 줄\r\n둘째 줄');
    assert.deepEqual(snapshot.rows[0], snapshot.rows[1]);
    // 같은 버전은 내보내기 요청을 생략한다.
    calls.length = 0;
    assert.equal((await runCollection({ output, fetchImpl: fetchReport })).status, 'unchanged');
    assert.equal(calls.length, 3);
    // 다른 버전의 잘못된 데이터 및 저장 오류는 기존 파일을 보존한다.
    version = '26-11-28 오후 1:1:2';
    failPrompt = true;
    await assert.rejects(runCollection({ output, fetchImpl: fetchReport }), /검색조건 XML: HTTP 응답 실패/);
    assert.equal(await fs.readFile(output, 'utf8'), first);
    failPrompt = false;
    expectedRows = 3;
    await assert.rejects(runCollection({ output, fetchImpl: fetchReport }), /행 수/);
    assert.equal(await fs.readFile(output, 'utf8'), first);
    expectedRows = 2;
    delimiter = '\t';
    await assert.rejects(runCollection({ output, fetchImpl: fetchReport, rename: async () => {
      // 원자 교체 단계의 오류를 재현한다.
      throw new Error('모의 교체 실패');
    } }), /모의 교체 실패/);
    assert.equal(await fs.readFile(output, 'utf8'), first);
    assert.deepEqual(await fs.readdir(directory), ['snapshot.json']);
    // 탭 구분 데이터는 정상적으로 새 버전을 저장한다.
    assert.equal((await runCollection({ output, fetchImpl: fetchReport })).status, 'updated');
    assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).rows.length, 2);
  } finally {
    // 테스트가 소유한 파일을 정리한다.
    for (const name of await fs.readdir(directory)) await fs.unlink(join(directory, name));
    await fs.rmdir(directory);
  }
}

// 수집 흐름 전체를 한 시나리오로 검증한다.
test('업종 보고서 수집, 갱신 생략 및 실패 복구', verifyCollection);
