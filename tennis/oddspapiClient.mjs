// oddspapiClient.mjs — pull real tennis total-games lines from OddsPapi (historical on free tier).
// Confirmed from docs: host https://api.oddspapi.io, apiKey query param, fixtures expose
//   bookmakerOdds → {book} → markets → {marketId} → outcomes → {outcomeId} → players → {price,...}
// IDs (tennis sportId, total-games marketId) are NOT hardcoded — resolved by name from /sports and
// /markets, because the docs' example sportId=10 is soccer. Verify /historical-odds params against
// https://oddspapi.io/en/docs/get-historical-odds (that page wasn't fully machine-readable here).
//
// No deps; Node 20+ global fetch. All functions throw on HTTP error so the caller can retry.

const BASE = 'https://api.oddspapi.io/v4';

export function makeClient(apiKey, { bookmaker = 'pinnacle' } = {}) {
  if (!apiKey) throw new Error('OddsPapi apiKey required');
  const get = async (path, params = {}) => {
    const qs = new URLSearchParams({ ...params, apiKey }).toString();
    const r = await fetch(`${BASE}/${path}?${qs}`);
    if (!r.ok) throw new Error(`OddsPapi ${path} → HTTP ${r.status}`);
    return r.json();
  };

  const api = {
    getSports: () => get('sports'),
    getMarkets: () => get('markets'),
    getTournaments: (sportId) => get('tournaments', { sportId }),
    getParticipants: (ids) => get('participants', ids ? { participantIds: ids.join(',') } : {}),
    getOddsByTournaments: (tournamentIds, oddsFormat = 'decimal') =>
      get('odds-by-tournaments', { bookmaker, tournamentIds: tournamentIds.join(','), oddsFormat }),
    // Historical snapshot. Param names per OddsPapi's historical docs — confirm before a big run.
    getHistoricalOdds: (params) => get('historical-odds', { bookmaker, oddsFormat: 'decimal', ...params }),

    // Resolve tennis sportId by name (docs example sportId=10 is soccer — do not assume).
    async resolveTennisSportId() {
      const sports = await api.getSports();
      const t = (Array.isArray(sports) ? sports : sports?.data || [])
        .find((s) => /tennis/i.test(s.name || s.sportName || '') && !/table/i.test(s.name || ''));
      if (!t) throw new Error('tennis sportId not found in /sports');
      return t.sportId ?? t.id;
    },
    // Resolve the total-games market id by name.
    async resolveTotalGamesMarketId() {
      const markets = await api.getMarkets();
      const list = Array.isArray(markets) ? markets : markets?.data || [];
      const m = list.find((x) => /total.*games/i.test(x.name || x.marketName || ''));
      if (!m) throw new Error('total-games market id not found in /markets');
      return String(m.marketId ?? m.id);
    },
  };
  return api;
}

// Extract total-games over/under lines from one fixture's bookmakerOdds.
// totalsMarketId: resolved id (string). Falls back to scanning any market whose outcomes look like
// over/under with a point/handicap, so it still works if the id resolution is off.
export function normalizeTotals(fixture, totalsMarketId) {
  const out = [];
  const books = fixture.bookmakerOdds || {};
  for (const [book, bd] of Object.entries(books)) {
    const markets = bd.markets || {};
    const scan = (mkt) => {
      const lines = new Map(); // point → { over, under }
      for (const oc of Object.values(mkt.outcomes || {})) {
        for (const pl of Object.values(oc.players || {})) {
          const side = /over/i.test(pl.bookmakerOutcomeId || '') ? 'over'
            : /under/i.test(pl.bookmakerOutcomeId || '') ? 'under' : null;
          const point = pl.handicap ?? pl.point ?? oc.handicap ?? oc.point ?? mkt.handicap;
          if (side == null || point == null || pl.price == null) continue;
          const key = Number(point);
          if (!lines.has(key)) lines.set(key, {});
          lines.get(key)[side] = pl.price;
        }
      }
      for (const [line, px] of lines) if (px.over != null && px.under != null)
        out.push({ book, line, overPrice: px.over, underPrice: px.under });
    };
    if (totalsMarketId && markets[totalsMarketId]) scan(markets[totalsMarketId]);
    else for (const mkt of Object.values(markets)) scan(mkt); // fallback: scan all
  }
  return out;
}

// Reduce a fixture's many book/line rows to one representative closing line (median handicap
// across books) — the number to grade against.
export function consensusLine(rows) {
  if (!rows.length) return null;
  const pts = rows.map((r) => r.line).sort((a, b) => a - b);
  return pts[Math.floor(pts.length / 2)];
}

export default { makeClient, normalizeTotals, consensusLine };
