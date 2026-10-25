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

/**
 * Extract like-for-like two-sided PinnOdds captures. Selection of a
 * near-even priced spread/total is a reference threshold, not proof of the
 * provider's official main line. Captures after kickoff are never used.
 */
export function selectCfbPinnoddsPregameReferences(rows = [], games = []) {
  const known = new Map(games.map(g => [String(g?.id || ""), g]));
  const selected = new Map();
  for (const row of rows) {
    const key = String(row?.game_id || "");
    const game = known.get(key);
    if (!game || row.provider !== "PinnOdds") continue;
    const observed = Date.parse(row.captured_at || "");
    const start = Date.parse(game.start || "");
    const family = row.market_family;
    const first = Number(row.first_decimal), second = Number(row.second_decimal);
    if (!["spread", "total", "moneyline"].includes(family) ||
        !Number.isFinite(observed) || !Number.isFinite(start) ||
        observed >= start || start-observed > 7*86400000 ||
        !Number.isFinite(first) || !Number.isFinite(second) ||
        first <= 1 || second <= 1) continue;
    const one = 1/first, two = 1/second;
    if (one + two < .95 || one + two > 1.18) continue;
    const line = family === "moneyline" ? null : Number(row.line);
    if (family !== "moneyline" && (!Number.isFinite(line) || Math.abs(line)>300)) continue;
    const balance = Math.abs(one - .5) + Math.abs(two - .5);
    if (family !== "moneyline" && balance > .27) continue;
    const existing = selected.get(key) || {};
    const prior = existing[family];
    if (!prior || observed > prior._time || (observed === prior._time && balance < prior._balance)) {
      existing[family] = {
        ...family === "spread" ? {homeLine:line} : family === "total" ? {line} : {homeDecimal:first,awayDecimal:second},
        capturedAt:row.captured_at,source:"PinnOdds",
        sourceClockVerified:false,executionEligible:false,
        _time:observed,_balance:balance
      };
      selected.set(key, existing);
    }
  }
  for (const refs of selected.values()) {
    for (const family of ["spread","total","moneyline"]) {
      if (!refs[family]) continue;
      const {_time,_balance,...safe}=refs[family];
      refs[family]=safe;
    }
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
    const byGame = selectCfbPregameTotalReferences(out, games);
    const pairedPinnodds = [];
    for (let offset = 0; offset < ids.length; offset += 40) {
      const chunk = ids.slice(offset, offset + 40);
      const placeholders = chunk.map(() => "?").join(",");
      const sql = `SELECT a.game_id,a.provider,a.market_family,a.line,a.captured_at,
         a.decimal_odds AS first_decimal,b.decimal_odds AS second_decimal
        FROM cfb_current_market_quotes a
        JOIN cfb_current_market_quotes b
          ON b.game_id=a.game_id AND b.provider=a.provider
          AND b.market_family=a.market_family AND b.captured_at=a.captured_at
          AND b.source_market_id=a.source_market_id
          AND ((a.market_family='moneyline' AND b.line IS NULL AND b.side='away')
            OR (a.market_family='spread' AND b.side='away' AND ABS(b.line+a.line)<0.001)
            OR (a.market_family='total' AND b.side='under' AND ABS(b.line-a.line)<0.001))
        WHERE a.game_id IN (${placeholders}) AND a.provider='PinnOdds'
          AND ((a.market_family='moneyline' AND a.side='home')
            OR (a.market_family='spread' AND a.side='home')
            OR (a.market_family='total' AND a.side='over'))
          AND a.decimal_odds>1 AND b.decimal_odds>1
        ORDER BY a.captured_at DESC LIMIT 2000`;
      const result = await env.CFB_DB.prepare(sql).bind(...chunk).all();
      pairedPinnodds.push(...(result?.results || []));
    }
    const pinnacle = selectCfbPinnoddsPregameReferences(pairedPinnodds, games);
    for (const [id, refs] of pinnacle) {
      const existing = byGame.get(id);
      const firstAt = refs.spread?.capturedAt || refs.total?.capturedAt || refs.moneyline?.capturedAt || null;
      byGame.set(id, {
        ...(existing || {
          source:"PinnOdds", capturedAt:firstAt, total:refs.total?.line ?? null,
          sourceClockVerified:false,pregameReferenceOnly:true,current:false,
          executionEligible:false,canAuthorizeWager:false,canQualify:false
        }),
        pinnodds:refs,
      });
    }
    return byGame;
  } catch {
    return empty; // Optional context never breaks the game board.
  }
}
