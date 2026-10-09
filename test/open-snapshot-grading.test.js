import test from 'node:test';
import assert from 'node:assert/strict';
import { persistSnapshot, gradeSnapshot, excludeSnapshotsForGame } from '../functions/lib/store.js';

const row = { id: 'fixed:EARLY', gameId: 'fixed', sport: 'nfl', date: '2026-10-09', checkpoint: 'EARLY',
  frozenAt: '2026-10-09T12:00:00Z', projHome: 25.2, projAway: 18.2, actualHome: null, actualAway: null,
  gradedAt: null, gameStatus: 'OPEN' };
function fixture({ legacy = false, failure = false } = {}) {
  const calls = []; let failed = false;
  const env = { DB: { prepare(sql) { let values; return { bind(...v) { values = v; return this; },
    async first() { return null; }, async run() {
      if (legacy && sql.startsWith('INSERT OR IGNORE') && sql.includes('projection_state')) throw new Error('no such column: projection_state');
      if (failure && !failed) { failed = true; throw new Error('fixture transient failure'); }
      calls.push({ sql, values }); return { meta: { changes: 1 } };
    } }; } } };
  return { calls, env };
}
for (const legacy of [false, true]) {
  test(`OPEN publication does not grade through ${legacy ? 'legacy' : 'current'} persistence`, async () => {
    const f = fixture({ legacy }); const before = structuredClone(row);
    assert.equal((await persistSnapshot(f.env, row)).ok, true);
    assert.equal(f.calls.filter(x => x.sql.startsWith('UPDATE prediction_snapshots')).length, 0);
    assert.equal(f.calls[0].values[36], null);
    assert.deepEqual(row, before);
  });
  test(`OPEN insertion ignores a supplied grading timestamp in ${legacy ? 'legacy' : 'current'} schema`, async () => {
    const f = fixture({ legacy }); await persistSnapshot(f.env, { ...row, gradedAt: '2026-10-09T12:01:00Z' });
    assert.equal(f.calls[0].values[36], null);
    assert.equal(f.calls.length, 1);
  });
}
test('direct OPEN grading fails closed even with scores and timestamp', async () => {
  const f = fixture();
  assert.deepEqual(await gradeSnapshot(f.env, { ...row, actualHome: 0, actualAway: 3, gradedAt: '2026-10-09T12:01:00Z' }), { ok: false, reason: 'no-final' });
  assert.equal(f.calls.length, 0);
});
test('fixed final result including zero retains existing grading and immutable projection behavior', async () => {
  const f = fixture(); const final = { ...row, gameStatus: 'FINAL', actualHome: 0, actualAway: 3, gradedAt: '2026-10-09T23:00:00Z' };
  await gradeSnapshot(f.env, final); await gradeSnapshot(f.env, final);
  assert.equal(f.calls.length, 2);
  for (const c of f.calls) {
    assert.deepEqual(c.values, [0, 3, '2026-10-09T23:00:00Z', row.id]);
    assert.match(c.sql, /WHERE id = \? AND actual_home IS NULL/);
    assert.doesNotMatch(c.sql, /SET\s+(?:frozen_at|proj_home)/);
  }
});
test('failed OPEN insertion followed by retry never grades', async () => {
  const f = fixture({ failure: true });
  assert.equal((await persistSnapshot(f.env, row)).ok, false);
  assert.equal((await persistSnapshot(f.env, row)).ok, true);
  assert.equal(f.calls.filter(c => c.sql.startsWith('UPDATE prediction_snapshots')).length, 0);
});
test('explicit learning exclusion keeps its existing separate path', async () => {
  const f = fixture(); await excludeSnapshotsForGame(f.env, { gameId: 'fixed', excludedAt: '2026-10-09T12:30:00Z' });
  assert.equal(f.calls.length, 2); assert.match(f.calls[0].sql, /LEARNING_EXCLUDED/);
});
