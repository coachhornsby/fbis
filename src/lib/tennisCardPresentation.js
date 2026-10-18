// Display-only contract. Research and market probabilities never stand in for PURE.
const num = v => v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const implied = (offer) => {
  const c = num(offer?.contractPrice);
  if (c != null && c > 0 && c < 1) return c;
  const d = num(offer?.decimalOdds);
  return d != null && d > 1 ? 1 / d : null;
};
function pairedBookPrior(game) {
  const ref = game?.market?.reference || {};
  const snapHome = num(ref.noVig?.home), snapAway = num(ref.noVig?.away);
  if (snapHome > 0 && snapHome < 1 && snapAway > 0 && snapAway < 1 && Math.abs(snapHome + snapAway - 1) < .0001) {
    return { home: snapHome, away: snapAway, observedAt: game?.tennisProjection?.marketObservedAt || ref.observedAt, source: 'snapshot', maxAgeMs: 2 * 3600000, requireContemporaneous: true };
  }
  const pin = Array.isArray(game?.pinnoddsResearch?.offers) ? game.pinnoddsResearch.offers : [];
  const venue = Array.isArray(game?.market?.venueOffers) ? game.market.venueOffers : [];
  const books = [
    ...pin.map(o => ({ ...o, _book: 'PinnOdds' })),
    ...venue.filter(o => String(o.source || '').startsWith('Polymarket US') || o.source === 'PinnOdds')
      .map(o => ({ ...o, _book: o.source })),
  ].filter(o => o.marketFamily === 'moneyline' && (o.period === 'full_game' || o.period === 'fg'));
  const home = books.find(o => o.side === 'home');
  const away = books.find(o => o.side === 'away');
  const ih = implied(home), ia = implied(away);
  if (!(ih > 0 && ih < 1 && ia > 0 && ia < 1)) return null;
  const sum = ih + ia;
  return {
    home: ih / sum, away: ia / sum,
    observedAt: home.capturedAt || home.sourceObservedAt || home.collectedAt || away.capturedAt || away.sourceObservedAt || away.collectedAt || game?.pinnoddsResearch?.latestCapturedAt || ref.observedAt,
    source: home._book || 'book',
    // PinnOdds board receipts are capture-clock only; allow the same 24h research window.
    maxAgeMs: 24 * 3600000,
    requireContemporaneous: false,
  };
}
export function tennisProjectionDisplay(game, now = Date.now()) {
  const t = game?.tennisProjection || {}, ref = game?.market?.reference || {};
  const a = num(t.player1WinProb), b = num(t.player2WinProb);
  const valid = t.eventIntegrity?.valid === true && a > 0 && a < 1 && b > 0 && b < 1 && Math.abs(a + b - 1) < .0001;
  const prior = pairedBookPrior(game);
  const observed = prior?.observedAt || t.marketObservedAt || ref.observedAt;
  const quoteTime = Date.parse(observed || ''), decisionTime = Date.parse(t.decisionTimestamp || '');
  const marketP1 = prior?.home ?? null, marketP2 = prior?.away ?? null;
  const maxAge = prior?.maxAgeMs ?? 2 * 3600000;
  const marketFresh = Number.isFinite(quoteTime) && quoteTime <= now && now - quoteTime <= maxAge;
  const paired = marketP1 > 0 && marketP1 < 1 && marketP2 > 0 && marketP2 < 1 && Math.abs(marketP1 + marketP2 - 1) < .0001;
  const contemporaneous = !prior?.requireContemporaneous || (Number.isFinite(decisionTime) && Math.abs(decisionTime - quoteTime) <= 2 * 3600000);
  const comparable = valid && marketFresh && paired && Number.isFinite(decisionTime) && decisionTime <= now && contemporaneous;
  return { valid, pHome: valid ? a : null, pAway: valid ? b : null,
    edgeHome: comparable ? (a - marketP1) * 100 : null, edgeAway: comparable ? (b - marketP2) * 100 : null,
    marketFresh, comparable, marketSource: prior?.source || null,
    marketReason: !observed ? 'Market timestamp unavailable' : !marketFresh ? 'Market snapshot stale or future-dated' : !paired ? 'Paired no-vig prices unavailable' : !comparable ? 'Projection and market clocks are not contemporaneous' : null,
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
