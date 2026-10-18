function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * a);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return 0.5 * (1 + sign * erf);
}

/** Probability the FBIS side (MORE/LESS) clears the Standard PrizePicks line. */
export function prizePicksWinChance(row = {}) {
  const explicit = finite(row.estimatedHitProbability ?? row.estimated_hit_probability);
  if (explicit != null) return Math.max(0, Math.min(1, explicit));
  const projection = finite(row.fbis_projection ?? row.fbisProjection);
  const line = finite(row.line);
  const sigma = finite(row.fbis_sigma ?? row.fbisSigma);
  if (projection == null || line == null || sigma == null || sigma <= 0) return null;
  const side = String(row.candidate_side || row.candidateSide || "").toUpperCase()
    || (projection > line ? "MORE" : projection < line ? "LESS" : "WATCH");
  if (side === "WATCH") return 0.5;
  const z = (projection - line) / sigma;
  const p = side === "MORE" ? normalCdf(z) : normalCdf(-z);
  return Math.max(0, Math.min(1, p));
}

function isStandardTier(row = {}) {
  return String(row.odds_tier || row.oddsTier || "standard").toLowerCase() === "standard";
}

export function prizePicksGroupKey(row = {}) {
  return [
    String(row.sport || "").toLowerCase(),
    String(row.player_name || row.playerName || "").toLowerCase(),
    String(row.canonical_market || row.marketCanonical || row.stat_type || row.market || "").toLowerCase(),
    String(row.duration || "full").toLowerCase(),
  ].join("|");
}

/**
 * Keep one Standard line per player/market, ranked by win chance.
 * sportFilter "all" keeps every sport; otherwise only that sport.
 */
export function selectTopPrizePicksCards(rows = [], { limit = 5, sportFilter = "all" } = {}) {
  const sport = String(sportFilter || "all").toLowerCase();
  const filtered = (rows || []).filter((row) => {
    if (!isStandardTier(row)) return false;
    if (finite(row.fbis_projection ?? row.fbisProjection) == null) return false;
    if (finite(row.line) == null) return false;
    if (sport !== "all" && String(row.sport || "").toLowerCase() !== sport) return false;
    const name = String(row.player_name || row.playerName || "").trim();
    if (!name || /^(?:[—?]|TBD|QB1|RB1|WR1|Unknown|Unidentified player)$/i.test(name)) return false;
    return true;
  });

  const bestByGroup = new Map();
  for (const row of filtered) {
    const key = prizePicksGroupKey(row);
    const win = prizePicksWinChance(row);
    const scored = { ...row, _winChance: win };
    const prev = bestByGroup.get(key);
    if (!prev) {
      bestByGroup.set(key, scored);
      continue;
    }
    const a = Number(scored._winChance ?? -1);
    const b = Number(prev._winChance ?? -1);
    if (a > b) bestByGroup.set(key, scored);
    else if (a === b) {
      const ae = Math.abs(Number(scored.fbis_projection ?? scored.fbisProjection) - Number(scored.line));
      const be = Math.abs(Number(prev.fbis_projection ?? prev.fbisProjection) - Number(prev.line));
      if (ae > be) bestByGroup.set(key, scored);
    }
  }

  return [...bestByGroup.values()]
    .sort((a, b) =>
      (Number(b._winChance ?? -1) - Number(a._winChance ?? -1))
      || (Number(b.confidence_stars ?? b.confidenceStars ?? 0) - Number(a.confidence_stars ?? a.confidenceStars ?? 0))
      || (Math.abs(Number(b.fbis_projection ?? b.fbisProjection) - Number(b.line))
        - Math.abs(Number(a.fbis_projection ?? a.fbisProjection) - Number(a.line)))
    )
    .slice(0, Math.max(0, limit));
}
