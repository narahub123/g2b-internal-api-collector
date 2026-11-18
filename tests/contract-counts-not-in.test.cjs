'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const source = fs.readFileSync(path.join(__dirname, '../src/server/g2b/repository/collection-attempts.ts'), 'utf8');
function preparedSql(variable) {
  const pattern = new RegExp('const ' + variable + ' = db\\.prepare\\(\\s*`([\\s\\S]*?)`\\s*\\);');
  const match = source.match(pattern);
  assert.ok(match, `${variable} SQL을 찾을 수 없습니다. 적용 스크립트를 먼저 실행하세요.`);
  return match[1];
}
const variants = [
  { section: 'contract-requests', table: 'contract_requests', sql: preparedSql('contractRequestCounts') },
  { section: 'contracts', table: 'contracts', sql: preparedSql('contractCounts') },
];
const cases = [
  ['빈 DB', [], [], [0, 0, 0]],
  ['저장만', [['A','000']], [], [1, 1, 0]],
  ['미수집만', [], [['A','000','']], [1, 0, 1]],
  ['저장+시도', [['A','000']], [['A','000','']], [1, 1, 0]],
  ['중복 시도', [], [['A','000',''], ['A','000',''], ['A','000','']], [1, 0, 1]],
  ['다른 공고 차수', [['A','000']], [['A','000',''], ['A','001','']], [2, 1, 1]],
  ['다른 입찰진행차수', [['A','000']], [['A','000','01']], [2, 1, 1]],
  ['혼합', [['A','000'], ['B','000']], [['A','000',''], ['A','001',''], ['C','000',''], ['C','000','']], [4, 2, 2]],
];
function baseline(table) {
  return `WITH saved AS (SELECT number, revision, '' AS opening_revision FROM ${table}),
  latest AS (SELECT MAX(id) AS id, number, revision, opening_revision FROM g2b_collection_attempts WHERE section = ? GROUP BY number, revision, opening_revision),
  targets AS (SELECT number, revision, opening_revision FROM saved UNION SELECT number, revision, opening_revision FROM latest)
  SELECT COUNT(*) AS total, (SELECT COUNT(*) FROM saved) AS collected,
  COUNT(*) - (SELECT COUNT(*) FROM saved) AS uncollected FROM targets`;
}
function values(row) { return [row.total, row.collected, row.uncollected]; }
for (const { section, table, sql } of variants) {
  for (const [name, saved, attempts, expected] of cases) {
    test(`${section}: ${name}`, () => {
      const db = new DatabaseSync(':memory:');
      try {
        db.exec(`CREATE TABLE g2b_collection_attempts (id INTEGER PRIMARY KEY, section TEXT NOT NULL, number TEXT NOT NULL, revision TEXT NOT NULL, opening_revision TEXT NOT NULL);
          CREATE TABLE ${table} (number TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(number, revision));`);
        const insertSaved = db.prepare(`INSERT INTO ${table} (number, revision) VALUES (?, ?)`);
        for (const [number, revision] of saved) insertSaved.run(number, revision);
        const insertAttempt = db.prepare('INSERT INTO g2b_collection_attempts (section, number, revision, opening_revision) VALUES (?, ?, ?, ?)');
        for (const [number, revision, opening] of attempts) insertAttempt.run(section, number, revision, opening);
        // 다른 업무의 이력이 현재 업무의 카드 집계에 섞이지 않는지 확인
        insertAttempt.run(section === 'contracts' ? 'contract-requests' : 'contracts', 'OTHER', '000', '');
        assert.deepEqual(values(db.prepare(baseline(table)).get(section)), expected, '기존 UNION 결과');
        assert.deepEqual(values(db.prepare(sql).get()), expected, '실제 프로젝트 NOT IN SQL 결과');
      } finally { db.close(); }
    });
  }
}
