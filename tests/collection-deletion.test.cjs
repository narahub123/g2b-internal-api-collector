require('../scripts/register-project-typescript.cjs');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { openCollectionDeletion } = require('../src/server/g2b/repository/collection-deletion.ts');
const { openNoticeQueue } = require('../src/server/g2b/repository/notice-queue.ts');
const { parseCollectionDeletion, isLocalDeletionRequest } = require('../src/features/delete-g2b/model/input.ts');
const { COLLECTION_LIST_PAGE_SIZE } = require('../src/shared/config/collection-list.ts');

const collectedAt = '2026-11-15T00:00:00.000Z';
const key = (number, revision = '000', openingRevision = '') => ({ number, revision, openingRevision });

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const queue = openNoticeQueue(db);
  db.exec(`
    CREATE TABLE notices (number TEXT, revision TEXT, collected_at TEXT, data TEXT DEFAULT '{}', PRIMARY KEY (number, revision));
    CREATE TABLE order_plans (number TEXT PRIMARY KEY, collected_at TEXT);
    CREATE TABLE opening_results (number TEXT, revision TEXT, opening_revision TEXT, collected_at TEXT,
      PRIMARY KEY (number, revision, opening_revision));
    CREATE TABLE g2b_collection_attempts (id INTEGER PRIMARY KEY, section TEXT, number TEXT, revision TEXT,
      opening_revision TEXT, status TEXT, started_at TEXT);
  `);
  db.function('notice_order_plan_lookup', (json) => JSON.parse(json).lookup ?? null);
  const insert = db.prepare('INSERT INTO g2b_collection_attempts VALUES (?, ?, ?, ?, ?, ?, ?)');
  const attempt = (id, section, target, status = 'failed', startedAt = collectedAt) => {
    insert.run(id, section, target.number, target.revision, target.openingRevision, status, startedAt);
  };
  return { db, queue, attempt, deletion: openCollectionDeletion(db) };
}

test('저장 원본과 미수집 이력을 한 요청에서 지우고 다른 차수와 업무는 보존한다', (t) => {
  const { db, attempt, deletion } = fixture(t);
  const saved = key('R26SAVED');
  const missing = key('R26MISSING');
  const otherRevision = key(saved.number, '001');
  for (const target of [saved, otherRevision]) {
    db.prepare('INSERT INTO notices (number, revision, collected_at) VALUES (?, ?, ?)').run(target.number, target.revision, collectedAt);
  }
  attempt(1, 'notices', saved);
  attempt(2, 'notices', missing);
  attempt(3, 'notices', missing, 'deferred');
  attempt(4, 'notices', otherRevision);
  attempt(5, 'contracts', saved);
  const targets = [saved, missing].map((target) => deletion.snapshot('notices', target).target);
  assert.equal(deletion.remove('notices', targets).ok, true);
  assert.equal(deletion.remove('notices', targets).ok, true);
  assert.deepEqual(db.prepare('SELECT revision FROM notices').all().map((r) => r.revision), ['001']);
  assert.deepEqual(db.prepare('SELECT id FROM g2b_collection_attempts ORDER BY id').all().map((r) => r.id), [4, 5]);
});

test('새 시도와 진행 중인 공고 작업을 발견하면 전체 요청을 취소한다', (t) => {
  const { db, queue, attempt, deletion } = fixture(t);
  const first = key('R26FIRST');
  const second = key('R26SECOND');
  attempt(1, 'notices', first);
  attempt(2, 'notices', second);
  const targets = [first, second].map((target) => deletion.snapshot('notices', target).target);
  attempt(3, 'notices', second, 'pending');
  assert.equal(deletion.snapshot('notices', second).blocked, true);
  assert.equal(deletion.remove('notices', targets).ok, false);
  db.exec("UPDATE g2b_collection_attempts SET status = 'failed' WHERE id = 3");
  assert.equal(deletion.remove('notices', targets).ok, false);
  queue.enqueue([{ ...second, methodCode: '' }], false);
  assert.equal(deletion.snapshot('notices', second).blocked, true);
  assert.equal(deletion.remove('notices', [targets[0], deletion.snapshot('notices', second).target]).ok, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM g2b_collection_attempts').get().count, 3);
});

test('개찰차수 한 건만 삭제하며 배치 중 SQL 오류는 이력 삭제도 롤백한다', (t) => {
  const { db, attempt, deletion } = fixture(t);
  const first = key('R26BID', '000', '001');
  const second = key(first.number, '000', '002');
  for (const target of [first, second]) {
    db.prepare('INSERT INTO opening_results VALUES (?, ?, ?, ?)').run(target.number, target.revision, target.openingRevision, collectedAt);
  }
  attempt(1, 'opening-results', first);
  const targets = [first, second].map((target) => deletion.snapshot('opening-results', target).target);
  db.exec(`CREATE TRIGGER fail_delete BEFORE DELETE ON opening_results WHEN OLD.opening_revision = '002'
    BEGIN SELECT RAISE(ABORT, '삭제 실패'); END`);
  assert.throws(() => deletion.remove('opening-results', targets), /삭제 실패/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM opening_results').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM g2b_collection_attempts').get().count, 1);
  assert.deepEqual(deletion.remove('opening-results', [targets[0]]), { ok: true, hasOtherOpeningResults: true });
  assert.deepEqual(db.prepare('SELECT opening_revision FROM opening_results').all().map((r) => r.opening_revision), ['002']);
});

test('발주계획 목록이 원본 행에 합친 호출 번호의 수집 이력도 삭제한다', (t) => {
  const { db, attempt, deletion } = fixture(t);
  const plan = key('R26PLAN', '');
  const alias = key('R26LOOKUP', '');
  db.prepare('INSERT INTO order_plans VALUES (?, ?)').run(plan.number, collectedAt);
  db.prepare('INSERT INTO notices VALUES (?, ?, ?, ?)').run('R26NOTICE', '000', collectedAt,
    JSON.stringify({ orderPlanNumber: plan.number, lookup: alias.number }));
  attempt(1, 'order-plans', plan);
  attempt(2, 'order-plans', alias);
  const { target } = deletion.snapshot('order-plans', plan);
  assert.equal(target.attemptId, 2);
  assert.equal(deletion.remove('order-plans', [target]).ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM g2b_collection_attempts').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notices').get().count, 1);
});

test('저장 시각이나 재사용된 시도 ID의 시작 시각 변경을 거부한다', (t) => {
  const { db, attempt, deletion } = fixture(t);
  const notice = key('R26STALE');
  db.prepare('INSERT INTO notices (number, revision, collected_at) VALUES (?, ?, ?)').run(notice.number, notice.revision, collectedAt);
  attempt(1, 'notices', notice);
  const { target } = deletion.snapshot('notices', notice);
  db.exec("UPDATE notices SET collected_at = '2026-11-15T01:00:00.000Z'");
  assert.deepEqual(deletion.remove('notices', [target]), { ok: false, reason: 'changed' });
  db.prepare('UPDATE notices SET collected_at = ?').run(collectedAt);
  db.exec('DELETE FROM g2b_collection_attempts');
  attempt(1, 'notices', notice, 'failed', '2026-11-15T01:00:00.000Z');
  assert.deepEqual(deletion.remove('notices', [target]), { ok: false, reason: 'changed' });
});

test('목록 페이지 크기와 업무별 저장 차수 규칙을 요청에 적용한다', () => {
  const targets = Array.from({ length: COLLECTION_LIST_PAGE_SIZE + 1 }, (_, index) => ({
    ...key(`R26KEY${index}`, '00'),
    collectedAt,
    attemptId: null,
    attemptStartedAt: null,
  }));
  assert.ok(parseCollectionDeletion('contracts', targets.slice(0, 1)));
  assert.ok(parseCollectionDeletion('contracts', targets.slice(0, COLLECTION_LIST_PAGE_SIZE)));
  assert.equal(parseCollectionDeletion('contracts', targets), null);
  assert.equal(parseCollectionDeletion('contracts', []), null);
  assert.equal(parseCollectionDeletion('contracts', [targets[0], targets[0]]), null);
  assert.equal(parseCollectionDeletion('notices', [targets[0]]), null);
  assert.ok(parseCollectionDeletion('notices', [{
    ...targets[0], number: '잘못 입력한 번호', revision: '000', collectedAt: null,
    attemptId: 1, attemptStartedAt: collectedAt,
  }]));
  for (const section of ['order-plans', 'prior-specs']) {
    assert.ok(parseCollectionDeletion(section, [{
      ...targets[0], number: '잘못 입력한 번호', revision: '', collectedAt: null,
      attemptId: 1, attemptStartedAt: collectedAt,
    }]));
  }
  assert.equal(parseCollectionDeletion('inspections', [targets[0]]), null);
});

test('삭제 요청은 로컬 Host와 동일한 Origin을 요구한다', () => {
  assert.equal(isLocalDeletionRequest(new Headers({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' })), true);
  assert.equal(isLocalDeletionRequest(new Headers({ host: 'example.com', origin: 'https://example.com',
    'x-forwarded-host': '127.0.0.1:3000' })), false);
  assert.equal(isLocalDeletionRequest(new Headers({ host: 'localhost:3000', origin: 'https://example.com' })), false);
  assert.equal(isLocalDeletionRequest(new Headers({ host: 'localhost:3000' })), false);
});
