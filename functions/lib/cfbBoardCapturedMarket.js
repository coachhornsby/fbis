/**
 * CFB display-only, event-matched captured market totals.
 * Reads priced TWO-SIDED Polymarket US observations from the CFB-owned D1.
 * The source does not independently verify quote timestamps, execution depth,
 * or a sportsbook consensus. No historical quote may authorize a wager.
 */
const implied = odds => {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0 || Math.abs(o) < 100) return null;
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
};

export function selectCfbPregameTotalReferences(rows = [], games = []) {
  const match = new Map(games.map(g => [String(g?.id || ""), g]));
  const selected = new Map();
  for (const row of rows) {
    const g = match.get(String(row?.game_id || ""));
    if (!g || row.provider !== "Polymarket US" || row.market_family !== "total") continue;
    const start = Date.parse(g.start || ""), observed = Date.parse(row.captured_at || "");
    const total = Number(row.line);
    const pOver = implied(row.over_odds), pUnder = implied(row.under_odds);
    if (!Number.isFinite(start) || !Number.isFinite(observed) || observed >= start ||
        start - observed > 7 * 86400000 || !Number.isFinite(total) ||
        total < 2 || total > 250 || pOver == null || pUnder == null) continue;
    // Quoted two-sided threshold near even probability, not an arbitrary alt.
    const imbalance = Math.abs(pOver - 0.5) + Math.abs(pUnder - 0.5);
    if (imbalance > 0.2 || Math.abs(pOver + pUnder - 1) > 0.12) continue;
    const key = String(row.game_id);
    const prev = selected.get(key);
    const next = {
      source: "Polymarket US", marketFamily: "total", total,
      capturedAt: row.captured_at, sourceClockVerified: false,
      pregameReferenceOnly: true, current: false,
      executionEligible: false, canAuthorizeWager: false, canQualify: false,
      _imbalance: imbalance, _at: observed,
    };
    // Most recent pregame snapshot; most balanced contract in that snapshot.
    if (!prev || observed > prev._at ||
        (observed === prev._at && imbalance < prev._imbalance))
      selected.set(key, next);
  }
  for (const [key, row] of selected) {
    const { _imbalance, _at, ...publicRow } = row;
    selected.set(key, publicRow);
  }
  return selected;
}

export async function loadCfbPregameTotalReferences(env, games = []) {
  const empty = new Map();
  if (!env?.CFB_DB?.prepare || !games.length) return empty;
  const ids = [...new Set(games.map(g => String(g?.id || "")).filter(v => /^[0-9]{5,15}$/.test(v)))].slice(0, 120);
  if (!ids.length) return empty;
  const out = [];
  try {
    for (let offset = 0; offset < ids.length; offset += 40) {
      const chunk = ids.slice(offset, offset + 40);
      const placeholders = chunk.map(() => "?").join(",");
      const sql = `SELECT a.game_id, a.provider, a.market_family, a.line, a.captured_at,
          a.american_odds AS over_odds, b.american_odds AS under_odds
        FROM cfb_current_market_quotes a
        JOIN cfb_current_market_quotes b
          ON b.game_id = a.game_id AND b.provider = a.provider
          AND b.market_family = a.market_family AND b.captured_at = a.captured_at
          AND b.line = a.line AND b.side = 'under'
        WHERE a.game_id IN (${placeholders}) AND a.provider = 'Polymarket US'
          AND a.market_family = 'total' AND a.side = 'over'
          AND a.american_odds IS NOT NULL AND b.american_odds IS NOT NULL
        ORDER BY a.captured_at DESC LIMIT 2500`;
      const r = await env.CFB_DB.prepare(sql).bind(...chunk).all();
      out.push(...(r?.results || []));
    }
    return selectCfbPregameTotalReferences(out, games);
  } catch {
    return empty; // Optional context never breaks the game board.
  }
}
