const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const source = fs.readFileSync(path.join(__dirname, '../src/server/g2b/repository/collection-attempts.ts'), 'utf8');
const match = source.match(/const noticeCounts = db\.prepare\(`([\s\S]*?)`\);/);
assert.ok(match, '입찰공고 전용 집계 SQL이 있어야 합니다');
const optimized = match[1];
const original = `WITH saved AS (SELECT number,revision,'' AS opening_revision FROM notices WHERE json_valid(data)),
latest AS (SELECT MAX(id) AS id,number,revision,opening_revision FROM g2b_collection_attempts WHERE section='notices' GROUP BY number,revision,opening_revision),
targets AS (SELECT number,revision,opening_revision FROM saved UNION SELECT number,revision,opening_revision FROM latest)
SELECT COUNT(*) AS total,(SELECT COUNT(*) FROM saved) AS collected,COUNT(*)-(SELECT COUNT(*) FROM saved) AS uncollected FROM targets`;
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE notices(number TEXT NOT NULL, revision TEXT NOT NULL, data TEXT, PRIMARY KEY(number,revision));
  CREATE TABLE g2b_collection_attempts(id INTEGER PRIMARY KEY, section TEXT NOT NULL, number TEXT NOT NULL, revision TEXT NOT NULL, opening_revision TEXT NOT NULL);
  CREATE INDEX g2b_collection_attempts_target ON g2b_collection_attempts(section,number,revision,opening_revision);`);
  return db;
}
const cases = [
  ['빈 데이터', [], []],
  ['저장만 존재', [['A','000','{}']], []],
  ['시도만 존재', [], [['notices','A','000','']]],
  ['저장·시도 일치 및 중복 시도', [['A','000','{}']], [['notices','A','000',''],['notices','A','000','']]],
  ['다른 개찰차수는 별도 대상', [['A','000','{}']], [['notices','A','000','001']]],
  ['잘못된 JSON은 수집으로 계산하지 않음', [['A','000','{']], [['notices','A','000','']]],
  ['공고 차수 구별', [['A','000','{}']], [['notices','A','001','']]],
  ['다른 업무 이력 제외', [], [['order-plans','A','','']]],
  ['복합 사례', [['A','000','{}'],['B','000','{'],['C','001','{}']], [['notices','A','000',''],['notices','B','000',''],['notices','C','000',''],['notices','C','001',''],['notices','C','001',''],['prior-specs','X','','']]],
];
for (const [name, saved, attempts] of cases) test(name, () => {
  const db = fixture();
  const insertSaved = db.prepare('INSERT INTO notices(number,revision,data) VALUES (?,?,?)');
  const insertAttempt = db.prepare('INSERT INTO g2b_collection_attempts(section,number,revision,opening_revision) VALUES (?,?,?,?)');
  for (const row of saved) insertSaved.run(...row);
  for (const row of attempts) insertAttempt.run(...row);
  assert.deepEqual(db.prepare(optimized).get(), db.prepare(original).get());
  db.close();
});
test('목록 공통 SQL은 유지하고 counts만 분기한다', () => {
  assert.match(source, /const counts = orderPlans \|\| section === "opening-results" \|\| section === "notices" \|\| section === "contract-requests" \|\| section === "contracts"\s*\? undefined/);
  assert.match(source, /section === "notices"\s*\? await noticeCounts\.get\(\)/);
  assert.match(source, /const overview = db\.prepare/);
});
