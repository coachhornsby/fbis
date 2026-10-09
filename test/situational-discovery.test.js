import test from 'node:test';
import assert from 'node:assert/strict';
import { scanGame, timestamp, evidenceValid, gradeSpread, economics as economicRaw, evaluatePattern as evaluateRaw, chronologicalFolds, PATTERNS } from '../research/situational/discovery.mjs';
const economics = (q, mass, opposite) => economicRaw(q, mass, opposite, { decisionAt: '2024-10-01T12:00:00Z' });
const plan = rows => ({ registration: { eventIds: [...new Set(rows.map(r => r.game.eventId))], patterns: PATTERNS, lockedAt: '2024-09-01T00:00:00Z', pitVerified: true, provenanceRef: 'locked-fixture-manifest' }, holdout: { startAt: '2024-10-01T00:00:00Z', endAt: '2024-11-01T00:00:00Z', unseen: true, provenanceRef: 'holdout-fixture' } });
const evaluatePattern = (rows, options) => evaluateRaw(rows, { ...plan(rows), ...options });

const evidence = value => ({ value, eventId: 'g', source: 'fixture', observedAt: '2024-10-01T11:55:00Z', availableAt: '2024-10-01T11:56:00Z', provenanceRef: 'fixture-sha', pitVerified: true });
const fixture = () => ({ sport: 'NFL', eventId: 'g', side: 'AWAY', decisionAt: '2024-10-01T12:00:00Z', kickoff: '2024-10-01T20:00:00Z',
  identity: { verified: true, homeId: 'a', awayId: 'b', provenanceRef: 'identity-sha' },
  features: { rest: evidence(4), opponentRest: evidence(7), record: evidence({ games: 4, wins: 0 }) },
  quote: { ...evidence(null), side: 'AWAY', market: 'FULL_GAME_SPREAD', line: 9.5, price: -112, book: 'fixture-book' } });
const scan = g => scanGame(g, { maxQuoteAgeSeconds: 300 });
const row = () => ({ game: fixture(), maxQuoteAgeSeconds: 300,
  outcome: { eventId: 'g', verified: true, source: 'fixture-final', status: 'FINAL', provenanceRef: 'final-sha', completedAt: '2024-10-01T23:00:00Z', observedAt: '2024-10-02T00:00:00Z', homeScore: 16, awayScore: 24 },
  oppositeQuote: { ...fixture().quote, side: 'HOME', line: -9.5, price: -108 } });

test('fixed-clock pregame conditions and quote are research only', () => {
  const p = scan(fixture()); assert.equal(p.status, 'SHADOW'); assert.equal(p.candidates.length, 3);
  assert.equal(p.qualified, false); assert.equal(p.canAuthorizeWager, false); assert.equal(p.candidates[0].validated, false);
});
test('outcome fields do not influence discovery', () => {
  const a = fixture(), b = fixture(); b.homeScore = 100; b.awayScore = 0;
  assert.deepEqual(scan(a), scan(b));
});
test('quote exact freshness boundary accepted, one millisecond stale unavailable', () => {
  const g = fixture(); assert.notEqual(scan(g).quote, null);
  g.quote.observedAt = '2024-10-01T11:54:59.999Z'; assert.equal(scan(g).quote, null);
});
test('missing, malformed, future and uncertified evidence fail closed', () => {
  for (const clock of [undefined, 'bad', '2024-10-01', '2024-10-01T11:55:00', '2024-10-01T12:00:00.001Z']) {
    const g = fixture(); g.quote.observedAt = clock; assert.equal(scan(g).quote, null);
  }
  const g = fixture(); g.features.rest.pitVerified = false;
  assert.equal(scan(g).diagnostics['short-rest'], 'MISSING_OR_INVALID_EVIDENCE');
});
test('future availability and backwards source clocks rejected', () => {
  const e = evidence(4); e.availableAt = '2024-10-01T12:00:01Z'; assert.equal(evidenceValid(e, fixture().decisionAt, 'g'), false);
  e.availableAt = '2024-10-01T11:00:00Z'; assert.equal(evidenceValid(e, fixture().decisionAt, 'g'), false);
});
test('calendar, leap-year, year 0096, offsets and precision validated', () => {
  for (const x of ['2023-02-29T00:00:00Z', '2024-04-31T00:00:00Z', '2024-01-01T24:00:00Z', '2024-01-01T00:60:00Z', '2024-01-01T00:00:60Z', '2024-01-01T00:00:00+14:01', '2024-01-01T00:00:00+15:00', '2024-01-01T00:00:00+01:60', '2024-01-01T00:00:00.1234Z']) assert.equal(timestamp(x), null, x);
  assert.notEqual(timestamp('0096-02-29T00:00:00Z'), null);
  assert.equal(timestamp('2024-02-29T12:00:00Z'), timestamp('2024-02-29T07:00:00-05:00'));
});
test('pregame cutoff and canonical identity required', () => {
  const g = fixture(); g.decisionAt = g.kickoff; assert.equal(scan(g).status, 'REJECTED');
  g.decisionAt = fixture().decisionAt; g.identity.homeId = g.identity.awayId; assert.equal(scan(g).status, 'REJECTED');
});
test('missing rest is unavailable; genuine zero remains measurable', () => {
  const g = fixture(); delete g.features.rest; assert.equal(scan(g).diagnostics['short-rest'], 'MISSING_OR_INVALID_EVIDENCE');
  g.features.rest = evidence(0); assert.equal(scan(g).diagnostics['short-rest'], 'MATCH');
});
test('unranked is explicit, not missing rank; exact negative line required', () => {
  const g = fixture(); g.sport = 'CFB'; g.features.opponentRanking = evidence({ ranked: true, rank: 20 }); g.quote.line = -2.5;
  assert.equal(scan(g).diagnostics['unranked-favorite'], 'MISSING_OR_INVALID_EVIDENCE');
  g.features.ranking = evidence({ ranked: false }); assert.equal(scan(g).diagnostics['unranked-favorite'], 'MATCH');
  g.quote.line = 0; assert.equal(scan(g).diagnostics['unranked-favorite'], 'NO_MATCH');
});
test('spread grading reconciles wins losses pushes and straight-up ties', () => {
  assert.deepEqual(gradeSpread({ side: 'AWAY', line: 9.5, homeScore: 16, awayScore: 24 }), { straightUp: 'WIN', ats: 'WIN' });
  assert.equal(gradeSpread({ side: 'HOME', line: -3, homeScore: 23, awayScore: 20 }).ats, 'PUSH');
  assert.equal(gradeSpread({ side: 'HOME', line: 0, homeScore: 20, awayScore: 20 }).straightUp, 'TIE');
  assert.equal(gradeSpread({ side: 'HOME', line: 0, homeScore: null, awayScore: 20 }), null);
});
test('missing odds never become default price or zero edge', () => {
  const q = fixture().quote; assert.equal(economics(q, null).expectedValueUnits, null);
  for (const price of [null, '', 0, -1, Infinity]) assert.equal(economics({ ...q, price }).status, 'UNAVAILABLE');
});
test('push-aware economics requires line-specific validated mass', () => {
  const q = fixture().quote, mass = { ...evidence(null), side: 'AWAY', line: 9.5, win: .6, loss: .3, push: .1, validationRef: 'research-validation', modelVersion: 'fixture-v1', validationAvailableAt: '2024-09-30T12:00:00Z' };
  assert.ok(Math.abs(economics(q, mass).expectedValueUnits - (.6 * 100 / 112 - .3)) < 1e-12);
  assert.equal(economics(q, { ...mass, line: 8.5 }).expectedValueUnits, null);
  assert.equal(economics(q, { ...mass, loss: .5 }).expectedValueUnits, null);
});
test('paired baseline rejects different book, line, event, or timestamp', () => {
  const r = row(); assert.ok(economics(r.game.quote, null, r.oppositeQuote).noVigBaseline > 0);
  for (const patch of [{ book: 'other' }, { line: -8.5 }, { eventId: 'other' }, { observedAt: '2024-10-01T11:54:00Z' }]) assert.equal(economics(r.game.quote, null, { ...r.oppositeQuote, ...patch }).noVigBaseline, null);
});
test('small samples, missing PIT, duplicates and missing baselines unsupported', () => {
  assert.equal(evaluatePattern([row()], { pattern: 'short-rest' }).status, 'UNSUPPORTED');
  const r = row(); r.game.quote.pitVerified = false; assert.equal(evaluatePattern([r], { pattern: 'short-rest' }).reason, 'INVALID_POINT_IN_TIME_INPUT');
  assert.equal(evaluateRaw([row(), row()], { ...plan([row()]), registration: { ...plan([row()]).registration, eventIds: ['g', 'other'] }, pattern: 'short-rest' }).reason, 'DUPLICATE_EVENT_UNIT');
  const b = row(); b.oppositeQuote = null; assert.equal(evaluatePattern([b], { pattern: 'short-rest' }).reason, 'MISSING_OUTCOME_OR_PAIRED_MARKET');
});
test('all preregistered hypotheses count in multiplicity, never qualification', () => {
  const result = evaluatePattern([row()], { pattern: 'short-rest', minSample: 1 });
  assert.equal(result.testedFamilySize, PATTERNS.length); assert.equal(result.qualified, false);
  assert.equal(evaluatePattern([], { pattern: 'short-rest', registeredPatternCount: 1 }).reason, 'INVALID_ANALYSIS_PLAN');
});
test('chronological folds refuse later outcome despite earlier season label', () => {
  const train = { ...row(), season: 2023 }, holdout = { ...row(), season: 2024 };
  train.game.decisionAt = '2023-10-01T12:00:00Z'; train.game.kickoff = '2023-10-01T20:00:00Z';
  train.outcome.observedAt = '2023-10-02T00:00:00Z'; assert.equal(chronologicalFolds([train, holdout], [2024])[0].train.length, 1);
  train.outcome.observedAt = '2024-10-02T00:00:00Z'; assert.throws(() => chronologicalFolds([train, holdout], [2024]), /CHRONOLOGICAL/);
});
test('LIVE scores, missing completion and wrong outcome source fail closed', () => {
  for (const patch of [{ status: 'LIVE' }, { completedAt: null }, { source: '' }]) {
    const r = row(); Object.assign(r.outcome, patch);
    assert.equal(evaluatePattern([r], { pattern: 'short-rest' }).reason, 'INVALID_OUTCOME_PROVENANCE');
  }
});
test('locked cohort and unseen holdout required; omitting losing game rejected', () => {
  assert.equal(evaluateRaw([row()], { pattern: 'short-rest' }).reason, 'MISSING_LOCKED_COHORT_OR_HOLDOUT');
  const options = plan([row()]); options.registration.eventIds.push('losing-game');
  assert.equal(evaluateRaw([row()], { ...options, pattern: 'short-rest' }).reason, 'MISSING_LOCKED_COHORT_OR_HOLDOUT');
  const p = plan([row()]); p.registration.lockedAt = '2024-10-02T00:00:00Z';
  assert.equal(evaluateRaw([row()], { ...p, pattern: 'short-rest' }).reason, 'MISSING_LOCKED_COHORT_OR_HOLDOUT');
});
test('future probability or model validation clock cannot produce EV', () => {
  const q = fixture().quote, mass = { ...evidence(null), side: 'AWAY', line: 9.5, win: .6, loss: .4, push: 0, validationRef: 'v', modelVersion: 'm', validationAvailableAt: '2025-01-01T00:00:00Z' };
  assert.equal(economics(q, mass).expectedValueUnits, null);
  mass.validationAvailableAt = '2024-09-01T00:00:00Z'; mass.availableAt = '2025-01-01T00:00:00Z';
  assert.equal(economics(q, mass).expectedValueUnits, null);
});
test('unsafe integers cannot become scores or measured counts', () => {
  assert.equal(gradeSpread({ side: 'HOME', line: 0, homeScore: 1e20, awayScore: 0 }), null);
  const g = fixture(); g.features.record.value.games = 1e20;
  assert.equal(scan(g).diagnostics['winless-after-three'], 'MISSING_OR_INVALID_EVIDENCE');
});
test('primary quote requires PIT and exact football spread semantics for EV', () => {
  const mass = { ...evidence(null), side: 'AWAY', line: 9.5, win: .6, loss: .4, push: 0, validationRef: 'v', modelVersion: 'm', validationAvailableAt: '2024-09-01T00:00:00Z' };
  for (const patch of [{ pitVerified: false }, { availableAt: '2025-01-01T00:00:00Z' }, { market: 'REGULATION_SPREAD' }, { side: 'WRONG' }]) {
    assert.equal(economics({ ...fixture().quote, ...patch }, mass).expectedValueUnits ?? null, null);
  }
});
test('fixed preregistered family rejects hidden or duplicated hypotheses', () => {
  for (const patterns of [[...PATTERNS, 'extra'], [...PATTERNS, PATTERNS[0]]]) {
    const p = plan([row()]); p.registration.patterns = patterns;
    assert.equal(evaluateRaw([row()], { ...p, pattern: 'short-rest' }).reason, 'MISSING_LOCKED_COHORT_OR_HOLDOUT');
  }
});
test('outcome provenance cannot be publication time or missing', () => {
  const r = row(); r.outcome.observedAt = r.game.decisionAt;
  assert.equal(evaluatePattern([r], { pattern: 'short-rest' }).reason, 'INVALID_OUTCOME_PROVENANCE');
});
test('other-game outcomes and uncertified opposite quotes cannot validate', () => {
  const r = row(); r.outcome.eventId = 'other';
  assert.equal(evaluatePattern([r], { pattern: 'short-rest' }).reason, 'INVALID_OUTCOME_PROVENANCE');
  const b = row(); b.oppositeQuote.pitVerified = false;
  assert.equal(evaluatePattern([b], { pattern: 'short-rest' }).reason, 'MISSING_OUTCOME_OR_PAIRED_MARKET');
});
