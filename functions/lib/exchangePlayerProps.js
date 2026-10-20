/** Read-only exchange prop contract. No observation grants wager authority. */
export const PROP_SPORTS = Object.freeze(['nfl','nba','nhl','mlb','cfb','wnba','cbb','tennis','soccer','npb','kbo']);
export function finitePropNumber(v) {
  if (v == null || typeof v === 'boolean' || String(v).trim() === '') return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}
export function exchangeProvider(source) {
  if (['Kalshi','Kalshi REST','Kalshi WebSocket'].includes(source)) return 'Kalshi';
  if (['Polymarket','Polymarket US','Polymarket US WebSocket'].includes(source)) return 'Polymarket';
  return null;
}
function payload(row) { try { return JSON.parse(row.raw_payload_json || '{}'); } catch { return {}; } }
/** Evidence is deliberately explicit; no fuzzy name matching or inferred settlement. */
export function normalizeExchangeProp(row, { now = Date.now(), maxAgeMs = 5 * 60_000 } = {}) {
  const provider = exchangeProvider(row.source);
  if (!provider || !PROP_SPORTS.includes(row.sport) || row.market_family !== 'player_prop') return null;
  const raw = payload(row), proof = raw.playerPropIdentity;
  const reasons = [];
  const start = Date.parse(row.event_start_time), observed = Date.parse(row.source_observed_at), collected = Date.parse(row.collected_at);
  const line = finitePropNumber(row.line);
  const same = (k, value) => value != null && value !== '' && proof?.[k] === value;
  const identityVerified = proof?.verified === true &&
    same('canonicalEventId', row.canonical_event_id) && same('canonicalPlayerId', row.canonical_player_id) &&
    same('providerEventId', row.provider_event_id) && same('providerPlayerId', row.provider_player_id) &&
    same('contractId', row.source_market_id) && same('stat', row.stat_family) && same('period', row.period) &&
    same('side', row.side) && same('threshold', line) && same('eventStart', row.event_start_time) &&
    ['over','under','yes','no'].includes(row.side) &&
    proof?.settlementVerified === true && typeof proof?.settlementTerms === 'string' && proof.settlementTerms.trim().length > 0;
  if (!identityVerified) reasons.push('PLAYER_EVENT_STAT_SETTLEMENT_UNVERIFIED');
  if (!Number.isFinite(start) || start <= now) reasons.push('EVENT_NOT_UPCOMING');
  // Never substitute collector time for the provider quote clock.
  const fresh = Number.isFinite(observed) && Number.isFinite(collected) && observed <= now && collected <= now && observed <= collected && now - observed <= maxAgeMs;
  if (!fresh) reasons.push('QUOTE_CLOCK_STALE_OR_UNVERIFIED');
  const ask = finitePropNumber(raw.bestAsk), size = finitePropNumber(raw.askSize);
  const priceVerified = raw.priceSemantics === 'purchase_ask' && raw.quoteSide === row.side && ask > 0 && ask < 1 && size > 0 && raw.marketState === 'OPEN';
  if (!priceVerified) reasons.push('PURCHASE_ASK_DEPTH_OR_STATUS_UNVERIFIED');
  return {
    id: row.id, provider, source: row.source, sport: row.sport, league: row.league,
    canonicalEventId: row.canonical_event_id, canonicalPlayerId: row.canonical_player_id,
    providerEventId: row.provider_event_id, providerPlayerId: row.provider_player_id,
    contractId: row.source_market_id, outcomeId: row.source_outcome_id,
    player_name: row.player_name, team: row.team, opponent: row.opponent,
    start_time: row.event_start_time, canonical_market: row.stat_family,
    line, side: row.side, period: row.period,
    settlementTerms: identityVerified ? proof.settlementTerms : null,
    identityVerified, priceVerified, fresh,
    purchaseAsk: priceVerified && fresh ? ask : null, executableSize: priceVerified && fresh ? size : null,
    observedAt: row.source_observed_at, collectedAt: row.collected_at,
    // Projection joins require frozen, independent model evidence; market payloads are not models.
    fbis_projection: null, calibratedProbability: null, modelStatus: 'UNMODELED',
    fees: null, expectedReturn: null, reasons: [...reasons,'INDEPENDENT_MODEL_JOIN_REQUIRED','FEES_UNVERIFIED'],
    marketAvailable: identityVerified && priceVerified && fresh && start > now,
    canQualify: false, executionEligible: false, canAuthorizeWager: false,
  };
}
export function latestExchangeProps(rows, options) {
  const latest = new Map();
  for (const row of rows) {
    const prop = normalizeExchangeProp(row, options); if (!prop) continue;
    const key = [prop.source,prop.contractId,prop.outcomeId,prop.side].join('|');
    const prior = latest.get(key);
    if (!prior || Date.parse(prop.collectedAt) > Date.parse(prior.collectedAt)) latest.set(key,prop);
  }
  return [...latest.values()];
}
