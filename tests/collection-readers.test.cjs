// 서버 조회 함수의 로컬 저장본 호환성과 입출력을 확인한다.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
require('../scripts/register-project-typescript.cjs');
const { getIndustryLawMetadata, getIndustryLawRows } = require('../src/server/collections/industry-law.ts');
const { getLegalDistrictMetadata, getLegalDistrictRows } = require('../src/server/collections/legal-districts.ts');

// 두 업무에 같은 저장 계약을 적용하되 행과 메타데이터는 각 업무의 형태로 구성한다.
const cases = [
  {
    name: '업종',
    getMetadata: getIndustryLawMetadata,
    getRows: getIndustryLawRows,
    criteria: { reportId: 'UI-ADOBAA-001R', lastUpdate: '최근 수정' },
    counts: { totalRows: 1, codes: 1 },
    row: { categoryCode: '1', categoryName: '분류', industryCode: '0001', industryName: '업종',
      legalBasis: '', relatedRules: '', active: 'Y', restrictedCode: '', restrictedName: '', allowedCode: '', allowedName: '' },
  },
  {
    name: '법정동',
    getMetadata: getLegalDistrictMetadata,
    getRows: getLegalDistrictRows,
    criteria: { lastSuccessfulDate: '2026-11-27' },
    counts: { total: 1, active: 1, abolished: 0 },
    row: { code: '1100000000', name: '서울특별시', status: '존재' },
  },
];

/**
 * 미수집, 두 저장 형식, 손상, 교체 경합을 읽기 전용 경로로 검증한다.
 * @param {object} sample 조회 함수와 데이터 예시.
 */
async function verifyReaders({ getMetadata, getRows, criteria, counts, row }) {
  // 독립된 임시 디렉터리에 두 목록 세대와 메타데이터를 준비한다.
  const directory = await fs.mkdtemp(join(tmpdir(), 'collection-read-'));
  const output = join(directory, 'current.json');
  const older = 'current.json.rows-00000000-0000-4000-8000-000000000001.json';
  const newer = 'current.json.rows-00000000-0000-4000-8000-000000000002.json';
  const metadata = { ...criteria, ...counts };
  const reads = [];
  const io = {
    lstat: fs.lstat,
    /**
     * 조회 중 읽힌 파일의 경로를 기록한다.
     * @param {string} path 읽을 파일.
     * @param {string} encoding 파일 인코딩.
     * @returns {Promise<string>} 파일 본문.
     */
    readFile(path, encoding) {
      reads.push(path);
      return fs.readFile(path, encoding);
    },
  };
  try {
    // 조회에 읽기 연산만 제공해 저장과 잠금이 호출되지 않는지 검사한다.
    assert.equal(await getMetadata({ output, io }), undefined);
    assert.equal(await getRows({ output, io }), undefined);
    const legacy = JSON.stringify({ ...criteria, rows: [row] });
    await fs.writeFile(output, legacy);
    assert.deepEqual(await getMetadata({ output, io }), metadata);
    assert.deepEqual(await getRows({ output, io }), [row]);
    assert.equal(await fs.readFile(output, 'utf8'), legacy);

    // 분리 형식의 메타데이터 조회는 목록 본문을 읽지 않는다.
    const original = JSON.stringify({ ...metadata, formatVersion: 1, listFile: older });
    await fs.writeFile(output, original);
    await fs.writeFile(join(directory, older), JSON.stringify([row]));
    reads.length = 0;
    assert.deepEqual(await getMetadata({ output, io }), metadata);
    assert.deepEqual(reads, [output]);
    assert.deepEqual(await getRows({ output, io }), [row]);

    // 빈 참조나 올바르지 않은 행은 오류로 보고한다.
    await fs.writeFile(join(directory, older), '[{}]');
    await assert.rejects(getRows({ output, io }), /목록 형식/);
    await fs.unlink(join(directory, older));
    await assert.rejects(getMetadata({ output, io }), { code: 'ENOENT' });
    await assert.rejects(getRows({ output, io }), { code: 'ENOENT' });
    await fs.writeFile(output, JSON.stringify({ formatVersion: 1, listFile: older }));
    await assert.rejects(getMetadata({ output, io }), /메타데이터 형식/);
    await assert.rejects(getRows({ output, io }), /메타데이터 형식/);

    // 목록을 읽기 직전에 갱신과 이전 세대 정리가 발생하도록 재현한다.
    await fs.writeFile(output, original);
    await fs.writeFile(join(directory, older), JSON.stringify([row]));
    await fs.writeFile(join(directory, newer), JSON.stringify([row]));
    const racingIo = {
      ...io,
      /**
       * 이전 세대 읽기 직전에 새 참조를 적용한다.
       * @param {string} path 읽을 경로.
       * @param {string} encoding 파일 인코딩.
       * @returns {Promise<string>} 읽은 본문.
       */
      async readFile(path, encoding) {
        if (path === join(directory, older)) {
          await fs.writeFile(output, JSON.stringify({ ...metadata, formatVersion: 1, listFile: newer }));
          await fs.unlink(path);
        }
        return io.readFile(path, encoding);
      },
    };
    reads.length = 0;
    assert.deepEqual(await getRows({ output, io: racingIo }), [row]);
    assert.deepEqual(reads, [output, join(directory, older), output, join(directory, newer)]);
  } finally {
    // 이 테스트가 생성한 파일만 정리한다.
    for (const file of await fs.readdir(directory)) await fs.unlink(join(directory, file));
    await fs.rmdir(directory);
  }
}

// 각 데이터셋의 공개 서버 함수를 같은 시나리오로 확인한다.
for (const sample of cases) test(sample.name + ' 저장본 조회', verifyReaders.bind(null, sample));
