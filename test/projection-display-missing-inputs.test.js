import test from 'node:test';
import assert from 'node:assert/strict';
import { bestEdge, matchupSignalLabel } from '../src/lib/boardEvidence.js';
import { buildMatchupFactors, attachMatchupFactors } from '../functions/lib/matchupFactors.js';
import { projectCfbMatchupV2 } from '../functions/lib/cfbMatchupV2.js';

const teams = { home: { abbr: 'HOME' }, away: { abbr: 'AWAY' } };
const football = (sport, home, away, coverage) => ({ sport, ...teams,
  [sport === 'cfb' ? 'cfbMatchupV2' : 'nflProShadow']: { ok: true, coverage,
    decomposition: { home: { layers: home }, away: { layers: away } } } });

for (const invalid of [null, undefined, '', ' ', false, 'bad', Infinity]) {
  test(`missing/malformed market comparison is unavailable: ${String(invalid)}`, () => {
    assert.equal(bestEdge({ comparison: { sideDiff: invalid, totalDiff: invalid } }).value, '—');
    assert.equal(matchupSignalLabel({ available: true, adjustment: invalid }, teams.away, teams.home).text, '—');
  });
}
test('real zero and valid market comparisons retain their original orientation', () => {
  assert.equal(bestEdge({ comparison: { sideDiff: 0, totalDiff: 0 } }).value, '+0');
  assert.equal(bestEdge({ ...teams, market: { spread: -7.5 }, comparison: { sideDiff: 1.3, sideSignedDiff: 1.3, totalDiff: null } }).detail, 'AWAY +7.5');
  assert.equal(bestEdge({ comparison: { totalDiff: -2, sideDiff: null } }).detail, 'UNDER');
  assert.equal(matchupSignalLabel({ available: true, adjustment: 0 }, teams.away, teams.home).text, 'EVEN');
});
test('missing offered spread cannot become pick em', () => {
  assert.equal(bestEdge({ ...teams, market: { spread: null }, comparison: { sideDiff: 1, sideSignedDiff: 1 } }).detail, 'SPREAD');
});
test('CFB neutral fallback layers respect original missing-input coverage', () => {
  const game = football('cfb', { passing: 0, rushing: 0, success: 0, explosive: 0, havoc: 0, pace: 0 },
    { passing: 0, rushing: 0, success: 0, explosive: 0, havoc: 0, pace: 0 },
    { missing: ['pass', 'rush', 'success', 'explosives', 'havoc'], available: ['pace'] });
  const rows = buildMatchupFactors(game);
  for (const id of ['passing', 'rushing', 'success', 'explosive', 'havoc']) {
    assert.equal(rows.find(r => r.id === id).edge, 'UNAVAILABLE');
    assert.equal(rows.find(r => r.id === id).value, null);
  }
  assert.equal(rows.find(r => r.id === 'pace').edge, 'EVEN');
});
test('real CFB producer neutralizes absent inputs without making them measured evidence', () => {
  const game = { sport: 'cfb', ...teams, projectionKind: 'FBIS', projHomeScore: 28.4, projAwayScore: 24.3 };
  const decomposition = projectCfbMatchupV2(game);
  assert.equal(decomposition.ok, true);
  assert.equal(decomposition.decomposition.home.layers.passing, 0);
  assert.ok(decomposition.coverage.missing.includes('pass'));
  const row = buildMatchupFactors({ ...game, cfbMatchupV2: decomposition }).find(r => r.id === 'passing');
  assert.equal(row.edge, 'UNAVAILABLE'); assert.equal(row.value, null);
  assert.equal(decomposition.home, 28.4); assert.equal(decomposition.away, 24.3);
});
test('NFL one-sided or null decomposition cannot fabricate an advantage', () => {
  const game = football('nfl', { pass: null, rush: 1 }, { pass: null, rush: null });
  for (const row of buildMatchupFactors(game).filter(r => ['pass', 'rush'].includes(r.id))) {
    assert.equal(row.edge, 'UNAVAILABLE'); assert.equal(row.value, null);
  }
});
test('NHL missing goalie and missing learned prior cannot appear neutral', () => {
  for (const home of [{ goalieId: null, impactPerShot: 0, reliability: 0 }, { goalieId: '1', impactPerShot: 0, source: 'NO_V2_PRIOR' }]) {
    const game = { sport: 'nhl', ...teams, nhlProV2: { ok: true, layers: { goalie: { home, away: { goalieId: '2', impactPerShot: 0.01, source: 'NHL_PRO_V2_GSAX' } } } } };
    const row = buildMatchupFactors(game).find(r => r.id === 'goaltending');
    assert.equal(row.edge, 'UNAVAILABLE'); assert.equal(row.value, null);
  }
});
test('NHL genuine learned neutral impacts remain neutral and labeled historical', () => {
  const goalie = { goalieId: '1', impactPerShot: 0, source: 'NHL_PRO_V2_GSAX' };
  const row = buildMatchupFactors({ sport: 'nhl', ...teams, nhlProV2: { ok: true, layers: { goalie: { home: goalie, away: goalie } } } }).find(r => r.id === 'goaltending');
  assert.equal(row.edge, 'EVEN'); assert.match(row.label, /historical/i);
});
test('presentation attachment preserves projection, provenance and authority fields', () => {
  const game = { ...football('cfb', { passing: 0 }, { passing: 0 }, { missing: ['pass'] }),
    projection: { home: 27, away: 25.7, total: 52.7 }, model: { canQualify: false }, sourceObservedAt: '2026-10-08T00:00:00Z' };
  const before = structuredClone(game); const after = attachMatchupFactors([game])[0];
  delete after.matchupFactors; assert.deepEqual(after, before); assert.deepEqual(game, before);
});
