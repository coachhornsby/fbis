// Display-only contract. Research and market probabilities never stand in for PURE.
const num = v => v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
export function tennisProjectionDisplay(game, now = Date.now()) {
  const t = game?.tennisProjection || {}, ref = game?.market?.reference || {};
  const a = num(t.player1WinProb), b = num(t.player2WinProb);
  const valid = t.eventIntegrity?.valid === true && a > 0 && a < 1 && b > 0 && b < 1 && Math.abs(a + b - 1) < .0001;
  const observed = t.marketObservedAt || ref.observedAt;
  const quoteTime = Date.parse(observed || ''), decisionTime = Date.parse(t.decisionTimestamp || '');
  const marketP1 = num(ref.noVig?.home), marketP2 = num(ref.noVig?.away);
  const marketFresh = Number.isFinite(quoteTime) && quoteTime <= now && now - quoteTime <= 2 * 3600000;
  const paired = marketP1 > 0 && marketP1 < 1 && marketP2 > 0 && marketP2 < 1 && Math.abs(marketP1 + marketP2 - 1) < .0001;
  const comparable = valid && marketFresh && paired && Number.isFinite(decisionTime) && decisionTime <= now && Math.abs(decisionTime - quoteTime) <= 2 * 3600000;
  return { valid, pHome: valid ? a : null, pAway: valid ? b : null,
    edgeHome: comparable ? (a - marketP1) * 100 : null, edgeAway: comparable ? (b - marketP2) * 100 : null,
    marketFresh, comparable, marketReason: !observed ? 'Market timestamp unavailable' : !marketFresh ? 'Market snapshot stale or future-dated' : !paired ? 'Paired no-vig prices unavailable' : !comparable ? 'Projection and market clocks are not contemporaneous' : null,
    reason: valid ? null : t.blockedReason || t.projectionBlockReason || t.eventIntegrity?.reason || game?.qualificationBlockReason || 'No verified persisted FBIS prediction',
    freshness: !valid ? 'BLOCKED' : !Number.isFinite(decisionTime) ? 'TIME UNVERIFIED' : decisionTime > now ? 'FUTURE TIMESTAMP' : now - decisionTime > 6 * 3600000 ? 'STALE' : 'CURRENT',
    createdAt: t.decisionTimestamp || null, version: t.modelVersion || game?.modelVersion || null,
    winner: valid ? (a > b ? game.home : b > a ? game.away : null) : null };
}
export function splitTennisName(name) {
  const parts = String(name || 'Player unavailable').trim().split(/\s+/);
  return { first: parts.length > 1 ? parts.shift() : '', last: parts.join(' ') };
}
export function neutralTennisAthlete(code, team = {}) {
  return team.neutralAthlete === true || ['RU', 'RUS', 'BY', 'BLR', 'AIN'].includes(String(code || '').toUpperCase());
}
