/**
 * Selective FBIS player-prop portfolio.
 *
 * Objective: publish a small daily set of the strongest independent model
 * disagreements, not maximize projection coverage.
 */
function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
  return sign * y;
}
function normalCdf(z) { return 0.5 * (1 + erf(z / Math.sqrt(2))); }
export function estimatedPropHitProbability(row = {}) {
  const projection = finite(row.fbisProjection ?? row.projection);
  const line = finite(row.line ?? row.marketLine);
  const sigma = finite(row.fbisSigma ?? row.sigma);
  if (projection == null || line == null || sigma == null || sigma <= 0) return null;
  return clamp(normalCdf(Math.abs(projection - line) / sigma), 0.5, 0.999);
}

const RELIABLE_SIGMA_SPORTS = new Set(["nfl","mlb","nhl","wnba","nba","cfb","cbb","tennis"]);

function sportKey(row = {}) {
  return String(row.sport || row.league || "").trim().toLowerCase();
}

function evidenceState(row = {}) {
  const sport = sportKey(row);
  const sigma = finite(row.fbisSigma ?? row.sigma);
  const role = finite(row.roleConfidence ?? row.role_confidence);
  const gate = String(row.propGate || row.gate || "").toUpperCase();
  const eligible = row.eligibleForCard;
  const feature = row.featureEvidence || {};
  const hasTracking = Boolean(feature.nextGen || feature.tracking || feature.snapShare);
  return {
    sport,
    sigmaReady: sigma != null && sigma > 0,
    role,
    gate,
    eligible,
    hasTracking,
  };
}

export function selectivePropStars(row = {}) {
  const projection = finite(row.fbisProjection ?? row.projection);
  const line = finite(row.line ?? row.marketLine);
  if (projection == null || line == null) return null;

  const sigma = finite(row.fbisSigma ?? row.sigma);
  const qRaw = finite(row.dataQuality ?? row.data_quality);
  const quality = qRaw == null ? 0.7 : clamp(qRaw > 1 ? qRaw / 100 : qRaw, 0, 1);
  const role = finite(row.roleConfidence ?? row.role_confidence);
  const uncertainty = String(row.uncertaintyState ?? row.uncertainty_state ?? "").toUpperCase();
  const delta = Math.abs(projection - line);

  let edgeScore;
  if (sigma != null && sigma > 0) edgeScore = delta / sigma;
  else edgeScore = delta / Math.max(Math.abs(line), 1) * 5;

  const adjusted = edgeScore * (0.55 + 0.45 * quality);
  let stars = adjusted >= 1.10 ? 5
    : adjusted >= 0.80 ? 4
      : adjusted >= 0.55 ? 3
        : adjusted >= 0.30 ? 2
          : 1;

  const evidence = evidenceState(row);
  if (quality < 0.55) stars = Math.min(stars, 2);
  if (role != null && role < 0.60) stars = Math.min(stars, 2);
  if (uncertainty === "HIGH") stars = Math.min(stars, 2);
  if (["BLOCKED","HOLD"].includes(evidence.gate) || evidence.eligible === false) stars = Math.min(stars, 1);

  // High-confidence prop ratings require an empirical dispersion estimate.
  // This prevents raw point gaps on volatile markets from being mislabeled as
  // conviction simply because the market line is numerically small.
  if (RELIABLE_SIGMA_SPORTS.has(evidence.sport) && !evidence.sigmaReady) {
    stars = Math.min(stars, 2);
  }

  // NFL tracking/snap evidence is additive, not mandatory, but a missing role
  // signal caps the rating until the player's workload is better established.
  if (evidence.sport === "nfl" && role == null) stars = Math.min(stars, 3);
  return stars;
}

export function rankSelectiveProps(rows = [], opts = {}) {
  const maxRows = clamp(Number(opts.maxRows ?? 20), 1, 50);
  const minStars = clamp(Number(opts.minStars ?? 3), 1, 5);
  const maxPerEvent = clamp(Number(opts.maxPerEvent ?? 2), 1, 10);
  const maxPerPlayer = clamp(Number(opts.maxPerPlayer ?? 1), 1, 5);

  const ranked = (rows || []).map((row) => {
    const projection = finite(row.fbisProjection ?? row.projection);
    const line = finite(row.line ?? row.marketLine);
    const sigma = finite(row.fbisSigma ?? row.sigma);
    const stars = selectivePropStars(row);
    if (projection == null || line == null || stars == null) return null;
    const delta = projection - line;
    const z = sigma != null && sigma > 0 ? Math.abs(delta) / sigma : null;
    const estimatedHitProbability = estimatedPropHitProbability(row);
    const roleConfidence = finite(row.roleConfidence ?? row.role_confidence);
    const qRaw = finite(row.dataQuality ?? row.data_quality);
    const quality = qRaw == null ? 0.7 : clamp(qRaw > 1 ? qRaw / 100 : qRaw, 0, 1);
    return {
      ...row,
      fbisProjection: projection,
      line,
      edge: delta,
      candidateSide: delta > 0 ? "MORE" : delta < 0 ? "LESS" : null,
      confidenceStars: stars,
      standardizedEdge: z,
      evidenceState: evidenceState(row),
      selectionScore: stars * 100 + (z ?? 0) * 15 + quality * 5 + (finite(row.roleConfidence ?? row.role_confidence) ?? 0) * 3,
    };
  }).filter((row) => row && row.candidateSide && row.confidenceStars >= minStars)
    .sort((a, b) => b.selectionScore - a.selectionScore);

  const out = [];
  const byEvent = new Map();
  const byPlayer = new Map();
  for (const row of ranked) {
    const event = String(row.eventId ?? row.fbisEventId ?? row.gameId ?? "");
    const player = String(row.playerId ?? row.playerName ?? "");
    if (event && (byEvent.get(event) || 0) >= maxPerEvent) continue;
    if (player && (byPlayer.get(player) || 0) >= maxPerPlayer) continue;
    out.push(row);
    if (event) byEvent.set(event, (byEvent.get(event) || 0) + 1);
    if (player) byPlayer.set(player, (byPlayer.get(player) || 0) + 1);
    if (out.length >= maxRows) break;
  }
  return {
    rows: out,
    counts: { input: (rows || []).length, modelable: ranked.length, published: out.length },
    policy: { maxRows, minStars, maxPerEvent, maxPerPlayer, minHitProbability, minRoleConfidence, quotaBySport: false, fillWeakQuota: false },
  };
}
