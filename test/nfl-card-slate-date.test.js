import test from 'node:test';
import assert from 'node:assert/strict';
import { nextNflSlateDate, nflCardReadiness } from '../scripts/lib/nfl-card-slate-date.mjs';

test('choose first actual NFL game date rather than empty today', () => {
  const rows = [
    { sport: 'nfl', date: '2026-10-20', fixtures: 0 },
    { sport: 'nfl', date: '2026-10-22', fixtures: 1 },
    { sport: 'nfl', date: '2026-10-25', fixtures: 12 },
  ];
  assert.equal(nextNflSlateDate(rows), '2026-10-22');
});

test('no games in the future window is a legitimate empty slate', () => {
  assert.equal(nextNflSlateDate([{ sport: 'nfl', date: '2026-06-20', fixtures: 0 }]), null);
  assert.equal(nflCardReadiness({ slateDate: null, http: 200, games: [] }).ok, true);
});

test('upcoming games require complete market evidence', () => {
  assert.equal(nflCardReadiness({ slateDate: '2026-10-22', http: 200, games: [] }).ok, false);
  assert.equal(nflCardReadiness({ slateDate: '2026-10-22', http: 200, games: [{ pinnoddsResearch: { pairedMarkets: ['spread'] } }] }).ok, false);
  assert.equal(nflCardReadiness({ slateDate: '2026-10-22', http: 200, games: [{ pinnoddsResearch: { pairedMarkets: ['spread', 'total'] } }] }).ok, true);
});
