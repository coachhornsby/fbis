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
  let stars = adjusted >= 1.0 ? 5
    : adjusted >= 0.72 ? 4
      : adjusted >= 0.48 ? 3
        : adjusted >= 0.25 ? 2
          : 1;

  if (quality < 0.45) stars = Math.min(stars, 2);
  if (role != null && role < 0.5) stars = Math.min(stars, 2);
  if (uncertainty === "HIGH") stars = Math.min(stars, 2);
  return stars;
}

export function rankSelectiveProps(rows = [], opts = {}) {
  const maxRows = clamp(Number(opts.maxRows ?? 20), 1, 50);
  const minStars = clamp(Number(opts.minStars ?? 2), 1, 5);
  const maxPerEvent = clamp(Number(opts.maxPerEvent ?? 3), 1, 10);
  const maxPerPlayer = clamp(Number(opts.maxPerPlayer ?? 2), 1, 5);

  const ranked = (rows || []).map((row) => {
    const projection = finite(row.fbisProjection ?? row.projection);
    const line = finite(row.line ?? row.marketLine);
    const sigma = finite(row.fbisSigma ?? row.sigma);
    const stars = selectivePropStars(row);
    if (projection == null || line == null || stars == null) return null;
    const delta = projection - line;
    const z = sigma != null && sigma > 0 ? Math.abs(delta) / sigma : null;
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
      selectionScore: stars * 100 + (z ?? Math.abs(delta) / Math.max(Math.abs(line), 1) * 5) * 10 + quality * 5,
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
    policy: { maxRows, minStars, maxPerEvent, maxPerPlayer, quotaBySport: false, fillWeakQuota: false },
  };
}
