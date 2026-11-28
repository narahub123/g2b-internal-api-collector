// 실행 디렉터리와 관계없이 프로젝트 환경 설정을 읽는다.
const { resolve } = require('node:path');
const { parseArgs } = require('node:util');
const root = resolve(__dirname, '..');
require('@next/env').loadEnvConfig(root, true);
require('./register-project-typescript.cjs');
const { migrateIndustryLawToBlob, industryLawOutput } = require('../src/server/collections/industry-law.ts');
const { migrateLegalDistrictToBlob, legalDistrictOutput } = require('../src/server/collections/legal-districts.ts');

/** 기존 로컬 원본을 보존하면서 지정한 사전들을 한 번씩 이전한다. */
async function main() {
  // 경로 선택지는 이 명령에서만 받으며 이미 적용된 Blob을 덮어쓰지 않는다.
  const { values } = parseArgs({ options: { industry: { type: 'string' }, districts: { type: 'string' } } });
  const jobs = [
    ['업종 및 근거법규', values.industry ?? resolve(root, industryLawOutput), migrateIndustryLawToBlob],
    ['법정동코드', values.districts ?? resolve(root, legalDistrictOutput), migrateLegalDistrictToBlob],
  ];
  for (const [name, output, migrate] of jobs) {
    try {
      const result = await migrate(output);
      console.log(name + (result.status === 'imported' ? ' 이전 및 검증 완료 | ' + result.rows + '행' : ' 기존 Blob 자료 유지'));
    } catch (error) {
      console.error(name + ' 이전 실패 | ' + error.message);
      process.exitCode = 1;
    }
  }
}

// 잘못된 명령 인자도 실패 종료 코드로 전달한다.
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
