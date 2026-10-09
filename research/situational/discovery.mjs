// Offline research only. No persistence, provider calls, production routing or authority.
import { americanToDecimal, noVigPair } from '../../functions/lib/canonical/economicGrading.js';

export const VERSION = 'situational-research-v1';
export const PATTERNS = Object.freeze(['rest-disadvantage', 'short-rest', 'winless-after-three', 'unranked-favorite']);
const authority = Object.freeze({ mode: 'RESEARCH_ONLY', qualified: false, canAuthorizeWager: false });
const number = x => typeof x === 'number' && Number.isFinite(x);
const nonempty = x => typeof x === 'string' && x.trim().length > 0;

// Require explicit offset; round-trip calendar validation avoids JS overflow/year-0..99 coercion.
export function timestamp(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const oh = Number(m[10] || 0), om = Number(m[11] || 0);
  if (h > 23 || mi > 59 || s > 59 || oh > 14 || om > 59 || (oh === 14 && om !== 0)) return null;
  const local = new Date(0);
  local.setUTCFullYear(y, mo - 1, d); local.setUTCHours(h, mi, s, Number((m[7] || '').padEnd(3, '0')));
  if (local.getUTCFullYear() !== y || local.getUTCMonth() !== mo - 1 || local.getUTCDate() !== d) return null;
  const offset = (oh * 60 + om) * 60000 * (m[9] === '-' ? -1 : 1);
  return local.getTime() - offset;
}

// pitVerified is an adapter attestation, not proof created by this module. Callers must
// retain the referenced capture and independently establish its original availability.
export function evidenceValid(e, decisionAt, eventId) {
  const decision = timestamp(decisionAt), observed = timestamp(e?.observedAt), available = timestamp(e?.availableAt);
  return decision !== null && observed !== null && available !== null && observed <= available && available <= decision &&
    e?.pitVerified === true && e.eventId === eventId && nonempty(e.source) && nonempty(e.provenanceRef);
}

function marketValid(q, game, now, maxAgeSeconds) {
  const observed = timestamp(q?.observedAt);
  return evidenceValid(q, game.decisionAt, game.eventId) && q.side === game.side && q.market === 'FULL_GAME_SPREAD' &&
    nonempty(q.book) && number(q.line) && number(q.price) && Math.abs(q.price) >= 100 &&
    number(maxAgeSeconds) && maxAgeSeconds >= 0 && now - observed <= maxAgeSeconds * 1000;
}

export function scanGame(game, { maxQuoteAgeSeconds } = {}) {
  const now = timestamp(game?.decisionAt), kickoff = timestamp(game?.kickoff);
  const validGame = now !== null && kickoff !== null && now < kickoff && ['NFL', 'CFB'].includes(game?.sport) &&
    nonempty(game.eventId) && game.identity?.verified === true && nonempty(game.identity.provenanceRef) &&
    nonempty(game.identity.homeId) && nonempty(game.identity.awayId) && game.identity.homeId !== game.identity.awayId &&
    ['HOME', 'AWAY'].includes(game.side);
  if (!validGame) return { ...authority, version: VERSION, status: 'REJECTED', reason: 'INVALID_EVENT_OR_DECISION', candidates: [] };
  const read = key => evidenceValid(game.features?.[key], game.decisionAt, game.eventId) ? game.features[key].value : undefined;
  const rest = read('rest'), otherRest = read('opponentRest'), record = read('record'), rank = read('ranking'), otherRank = read('opponentRanking');
  const restValid = x => Number.isSafeInteger(x) && x >= 0;
  const quoteUsable = marketValid(game.quote, game, now, maxQuoteAgeSeconds);
  const conditions = {
    'rest-disadvantage': restValid(rest) && restValid(otherRest) ? rest < otherRest : null,
    'short-rest': restValid(rest) ? rest <= 5 : null,
    'winless-after-three': record && Number.isSafeInteger(record.games) && Number.isSafeInteger(record.wins) && record.games >= 0 && record.wins >= 0 && record.wins <= record.games ? record.games >= 3 && record.wins === 0 : null,
    'unranked-favorite': game.sport !== 'CFB' ? false : quoteUsable && rank?.ranked === false && otherRank?.ranked === true && Number.isInteger(otherRank.rank) && otherRank.rank >= 1 && otherRank.rank <= 25 ? game.quote.line < 0 : null,
  };
  return { ...authority, version: VERSION, eventId: game.eventId, sport: game.sport, side: game.side,
    decisionAt: game.decisionAt, kickoff: game.kickoff, status: 'SHADOW',
    quote: quoteUsable ? game.quote : null, marketComparisonStatus: quoteUsable ? 'RESEARCH_QUOTE' : 'UNAVAILABLE',
    diagnostics: Object.fromEntries(PATTERNS.map(p => [p, conditions[p] === null ? 'MISSING_OR_INVALID_EVIDENCE' : conditions[p] ? 'MATCH' : 'NO_MATCH'])),
    candidates: PATTERNS.filter(p => conditions[p] === true).map(pattern => ({ pattern, conditions: pattern,
      evidence: game.features, hypothesisOnly: true, validated: false })),
    unavailableFamilies: ['travel', 'public-disagreement', 'reverse-line-movement', 'quarterback-adjustment', 'combinations', 'incumbent-disagreement'],
  };
}

export function gradeSpread({ side, line, homeScore, awayScore }) {
  if (!['HOME', 'AWAY'].includes(side) || !number(line) || !Number.isSafeInteger(homeScore) || !Number.isSafeInteger(awayScore) || homeScore < 0 || awayScore < 0) return null;
  const margin = (homeScore - awayScore) * (side === 'HOME' ? 1 : -1);
  const ats = margin + line;
  return { straightUp: margin > 0 ? 'WIN' : margin < 0 ? 'LOSS' : 'TIE', ats: ats > 0 ? 'WIN' : ats < 0 ? 'LOSS' : 'PUSH' };
}

// Probability mass is supplied by a separately validated, line-specific model. Never
// infer cover probability from expected margin or observed pattern cover frequency.
export function economics(quote, mass, oppositeQuote, { decisionAt } = {}) {
  if (!number(quote?.price) || Math.abs(quote.price) < 100 || !number(quote.line) || !nonempty(quote.book)) return { status: 'UNAVAILABLE' };
  const decimal = americanToDecimal(quote.price);
  if (!Number.isFinite(decimal)) return { status: 'UNAVAILABLE' };
  const paired = evidenceValid(quote, decisionAt, quote.eventId) && evidenceValid(oppositeQuote, decisionAt, quote.eventId) && oppositeQuote.book === quote.book &&
    oppositeQuote.market === quote.market && oppositeQuote.side !== quote.side && ['HOME', 'AWAY'].includes(oppositeQuote.side) &&
    oppositeQuote.line === -quote.line && oppositeQuote.observedAt === quote.observedAt &&
    number(oppositeQuote.price) && Math.abs(oppositeQuote.price) >= 100;
  const validMass = evidenceValid(quote, decisionAt, quote.eventId) && quote.market === 'FULL_GAME_SPREAD' && ['HOME', 'AWAY'].includes(quote.side) && mass && ['win', 'loss', 'push'].every(k => number(mass[k]) && mass[k] >= 0 && mass[k] <= 1) &&
    Math.abs(mass.win + mass.loss + mass.push - 1) < 1e-12 && mass.eventId === quote.eventId && mass.line === quote.line && mass.side === quote.side &&
    nonempty(mass.validationRef) && nonempty(mass.modelVersion) && evidenceValid(mass, decisionAt, quote.eventId) &&
    timestamp(mass.validationAvailableAt) !== null && timestamp(mass.validationAvailableAt) <= timestamp(decisionAt);
  return { status: 'RESEARCH_ONLY', decimal, conditionalBreakeven: 1 / decimal,
    noVigBaseline: paired ? noVigPair(quote.price, oppositeQuote.price).a : null,
    expectedValueUnits: validMass ? mass.win * (decimal - 1) - mass.loss : null,
    calibratedMassStatus: validMass ? 'SUPPLIED_RESEARCH_MASS' : 'UNAVAILABLE', ...authority };
}

// One independent unit per event. Conflicting duplicates reject the entire evaluation.
// Training chooses hypotheses outside this function; holdout results cannot choose them.
export function evaluatePattern(rows, { pattern, registeredPatternCount = PATTERNS.length, minSample = 30, alpha = 0.05, registration, holdout } = {}) {
  const reject = reason => ({ ...authority, status: 'UNSUPPORTED', reason });
  if (!PATTERNS.includes(pattern) || !Number.isInteger(registeredPatternCount) || registeredPatternCount < PATTERNS.length || !Number.isInteger(minSample) || minSample < 1 || !number(alpha) || alpha <= 0 || alpha >= 1) return reject('INVALID_ANALYSIS_PLAN');
  const locked = timestamp(registration?.lockedAt), start = timestamp(holdout?.startAt), end = timestamp(holdout?.endAt);
  if (!Array.isArray(rows) || locked === null || start === null || end === null || locked >= start || start >= end ||
    registration?.pitVerified !== true || !nonempty(registration.provenanceRef) || holdout?.unseen !== true || !nonempty(holdout.provenanceRef) ||
    !Array.isArray(registration.eventIds) || !Array.isArray(registration.patterns) || registration.patterns.length !== PATTERNS.length || new Set(registration.patterns).size !== PATTERNS.length || !PATTERNS.every(p => registration.patterns.includes(p)) ||
    new Set(registration.eventIds).size !== registration.eventIds.length || registration.eventIds.length !== rows.length ||
    rows.some(r => !registration.eventIds.includes(r?.game?.eventId))) return reject('MISSING_LOCKED_COHORT_OR_HOLDOUT');
  const seen = new Set(), observations = [];
  for (const r of rows) {
    if (seen.has(r?.game?.eventId)) return reject('DUPLICATE_EVENT_UNIT');
    seen.add(r?.game?.eventId);
    const packet = scanGame(r.game, { maxQuoteAgeSeconds: r.maxQuoteAgeSeconds });
    const decision = timestamp(r.game.decisionAt);
    if (packet.status !== 'SHADOW' || !packet.quote || decision < start || decision >= end || locked >= decision || packet.diagnostics[pattern] === 'MISSING_OR_INVALID_EVIDENCE') return reject('INVALID_POINT_IN_TIME_INPUT');
    if (packet.diagnostics[pattern] === 'NO_MATCH') continue;
    const observed = timestamp(r.outcome?.observedAt);
    const completed = timestamp(r.outcome?.completedAt);
    if (r.outcome?.verified !== true || r.outcome.status !== 'FINAL' || r.outcome.eventId !== r.game.eventId || !nonempty(r.outcome.source) || !nonempty(r.outcome.provenanceRef) || observed === null || completed === null || completed <= timestamp(r.game.kickoff) || observed < completed) return reject('INVALID_OUTCOME_PROVENANCE');
    const grade = gradeSpread({ side: r.game.side, line: packet.quote.line, homeScore: r.outcome.homeScore, awayScore: r.outcome.awayScore });
    const pairedEvidence = evidenceValid(r.oppositeQuote, r.game.decisionAt, r.game.eventId);
    const econ = economics(packet.quote, null, pairedEvidence ? r.oppositeQuote : null, { decisionAt: r.game.decisionAt });
    if (!grade || econ.noVigBaseline === null) return reject('MISSING_OUTCOME_OR_PAIRED_MARKET');
    observations.push({ grade, baseline: econ.noVigBaseline, price: packet.quote.price });
  }
  const wins = observations.filter(x => x.grade.ats === 'WIN').length, pushes = observations.filter(x => x.grade.ats === 'PUSH').length;
  const n = observations.length - pushes, losses = n - wins;
  // Poisson-binomial upper tail for heterogeneous paired-market probabilities,
  // conditional on non-push outcomes. Multiple-testing denominator is preregistered.
  let pmf = [1];
  for (const { grade, baseline: p } of observations) {
    if (grade.ats === 'PUSH') continue;
    const next = Array(pmf.length + 1).fill(0);
    pmf.forEach((x, i) => { next[i] += x * (1 - p); next[i + 1] += x * p; }); pmf = next;
  }
  const pValue = pmf.slice(wins).reduce((a, b) => a + b, 0), adjustedP = Math.min(1, pValue * registeredPatternCount);
  const netUnits = observations.reduce((sum, x) => sum + (x.grade.ats === 'WIN' ? americanToDecimal(x.price) - 1 : x.grade.ats === 'LOSS' ? -1 : 0), 0);
  return { ...authority, status: n >= minSample && adjustedP < alpha ? 'RESEARCH_SIGNAL_REQUIRES_UNSEEN_VALIDATION' : 'UNSUPPORTED',
    pattern, cohortEvents: rows.length, nonMatchingEvents: rows.length - observations.length, events: observations.length, wins, losses, pushes, coverRateExcludingPushes: n ? wins / n : null,
    pValue, adjustedP, testedFamilySize: registeredPatternCount, netUnits,
    limitations: ['conditional-non-push-baseline', 'overlapping-patterns-not-independent', 'no-qualification', 'no-incumbent-incremental-value-proven'] };
}

export function chronologicalFolds(rows, testSeasons) {
  return testSeasons.map(season => {
    const test = rows.filter(r => r.season === season), train = rows.filter(r => Number.isInteger(r.season) && r.season < season);
    const firstDecision = Math.min(...test.map(r => timestamp(r.game?.decisionAt) ?? NaN));
    if (!test.length || !Number.isFinite(firstDecision) || [...train, ...test].some(r => timestamp(r.game?.decisionAt) === null || timestamp(r.game?.kickoff) === null || timestamp(r.game.decisionAt) >= timestamp(r.game.kickoff)) || train.some(r => timestamp(r.outcome?.observedAt) === null || timestamp(r.outcome.observedAt) <= timestamp(r.game.kickoff) || timestamp(r.outcome.observedAt) >= firstDecision)) throw new Error('CHRONOLOGICAL_LEAKAGE_OR_MISSING_CLOCK');
    return { season, train, test };
  });
}
