/**
 * Selective FBIS player-prop portfolio.
 *
 * Objective: publish a small daily set of the strongest independent model
 * disagreements, not maximize projection coverage. Market lines are comparison
 * targets only; they are never projection inputs.
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
  const poly =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t);
  const y = 1 - poly * Math.exp(-a * a);
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
  return {
    sport,
    sigmaReady: sigma != null && sigma > 0,
    role,
    gate,
    eligible,
    hasTracking: Boolean(feature.nextGen || feature.tracking || feature.snapShare),
  };
}

export function selectivePropStars(row = {}) {
  const projection = finite(row.fbisProjection ?? row.projection);
  const line = finite(row.line ?? row.marketLine);
  if (projection == null || line == null) return null;

  const sigma = finite(row.fbisSigma ?? row.sigma);
  const qRaw = finite(row.dataQuality ?? row.data_quality);
  const feature = row.featureEvidence || {};
  const inferredQuality = clamp(
    0.55 +
      (feature.nextGen || feature.tracking ? 0.15 : 0) +
      (feature.snapShare ? 0.15 : 0) +
      (feature.opponentMatchup ? 0.15 : 0),
    0,
    1
  );
  const quality = qRaw == null ? inferredQuality : clamp(qRaw > 1 ? qRaw / 100 : qRaw, 0, 1);
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

  // High-confidence ratings require an empirical dispersion estimate when the
  // model family supports one. Raw point gaps alone are not conviction.
  if (RELIABLE_SIGMA_SPORTS.has(evidence.sport) && !evidence.sigmaReady) {
    stars = Math.min(stars, 2);
  }

  // NFL v3 is fail-closed around role + recent-form + matchup evidence.
  if (evidence.sport === "nfl") {
    if (role == null) stars = Math.min(stars, 2);
    if (!feature.targetRole) stars = Math.min(stars, 1);
    if (!feature.recent5) stars = Math.min(stars, 2);
    if (!feature.positionDefense) stars = Math.min(stars, 3);
    if (!feature.snapShare) stars = Math.min(stars, 3);
    if (stars >= 5 && (role == null || role < 0.80 || !feature.nextGen || !feature.opponentMatchup)) stars = 4;
  }
  return stars;
}

export function rankSelectiveProps(rows = [], opts = {}) {
  const maxRows = clamp(Number(opts.maxRows ?? 20), 1, 50);
  const minStars = clamp(Number(opts.minStars ?? 3), 1, 5);
  const maxPerEvent = clamp(Number(opts.maxPerEvent ?? 2), 1, 10);
  const maxPerPlayer = clamp(Number(opts.maxPerPlayer ?? 1), 1, 5);
  const minHitProbability = clamp(Number(opts.minHitProbability ?? 0.60), 0.50, 0.90);
  const minRoleConfidence = clamp(Number(opts.minRoleConfidence ?? 0.60), 0, 1);

  const ranked = (rows || []).map((row) => {
    const projection = finite(row.fbisProjection ?? row.projection);
    const line = finite(row.line ?? row.marketLine);
    const sigma = finite(row.fbisSigma ?? row.sigma);
    const stars = selectivePropStars(row);
    if (projection == null || line == null || stars == null) return null;
    const delta = projection - line;
    const z = sigma != null && sigma > 0 ? Math.abs(delta) / sigma : null;
    const hitProbability = estimatedPropHitProbability(row);
    const roleConfidence = finite(row.roleConfidence ?? row.role_confidence);
    const qRaw = finite(row.dataQuality ?? row.data_quality);
    const feature = row.featureEvidence || {};
    const inferredQuality = clamp(
      0.55 +
        (feature.nextGen || feature.tracking ? 0.15 : 0) +
        (feature.snapShare ? 0.15 : 0) +
        (feature.opponentMatchup ? 0.15 : 0),
      0,
      1
    );
    const quality = qRaw == null ? inferredQuality : clamp(qRaw > 1 ? qRaw / 100 : qRaw, 0, 1);
    const evidence = evidenceState(row);
    return {
      ...row,
      fbisProjection: projection,
      line,
      edge: delta,
      candidateSide: delta > 0 ? "MORE" : delta < 0 ? "LESS" : null,
      confidenceStars: stars,
      standardizedEdge: z,
      estimatedHitProbability: hitProbability,
      evidenceState: evidence,
      selectionScore:
        stars * 100 +
        (z ?? 0) * 15 +
        (hitProbability ?? 0.5) * 20 +
        quality * 5 +
        (roleConfidence ?? 0) * 3,
    };
  }).filter((row) => {
    if (!row || !row.candidateSide || row.confidenceStars < minStars) return false;
    if (row.evidenceState?.gate === "BLOCKED" || row.evidenceState?.gate === "HOLD") return false;
    if (row.evidenceState?.eligible === false) return false;
    if (row.estimatedHitProbability != null && row.estimatedHitProbability < minHitProbability) return false;
    if (row.evidenceState?.sport === "nfl") {
      if (row.evidenceState?.role == null || row.evidenceState.role < minRoleConfidence) return false;
      if (!row.featureEvidence?.targetRole || !row.featureEvidence?.recent5) return false;
    }
    return true;
  }).sort((a, b) => b.selectionScore - a.selectionScore);

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
    policy: {
      maxRows,
      minStars,
      maxPerEvent,
      maxPerPlayer,
      minHitProbability,
      minRoleConfidence,
      quotaBySport: false,
      fillWeakQuota: false,
    },
  };
}
