export const CONFIDENCE_VERSION = "FBIS-CONFIDENCE-v2";

const HARD_DQ_STATES = new Set(["DQ", "BLOCKED", "INVALID", "FAILED", "REJECTED", "CORRUPT"]);

const TIER_SCORE_FALLBACK = Object.freeze({
  CONVICTION: 88,
  QUALIFIED: 76,
  LEAN: 62,
  WATCH: 58,
  PASS: 50,
  RESEARCH: 48,
  BLOCKED: 40,
  NO_MODEL: 20,
});

const CFB_STATE_SCORE = Object.freeze({
  COMPLETE: 76,
  PARTIAL: 60,
  PRIOR_ONLY: 46,
  PROVISIONAL: 44,
  LEAGUE_AVERAGE_ONLY: 30,
  UNAVAILABLE: 20,
  NO_MODEL: 20,
});

function num(v) {
  if (v == null || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function clamp100(v) {
  return Math.max(0, Math.min(100, Number(v) || 0));
}

function starsFromScore(score) {
  const s = clamp100(score);
  if (s >= 84) return 5;
  if (s >= 70) return 4;
  if (s >= 56) return 3;
  if (s >= 42) return 2;
  return 1;
}

function hasProjection(game = {}) {
  const sport = String(game?.sport || "").toLowerCase();
  if (sport === "nfl" && game?.nflProShadow?.ok) {
    const home = num(game.nflProShadow.home ?? game.nflProShadow.projectedHome);
    const away = num(game.nflProShadow.away ?? game.nflProShadow.projectedAway);
    if (Number.isFinite(home) && Number.isFinite(away)) return true;
  }
  const home = num(game?.model?.projHome ?? game?.projHome ?? game?.projHomeScore);
  const away = num(game?.model?.projAway ?? game?.projAway ?? game?.projAwayScore);
  return Number.isFinite(home) && Number.isFinite(away);
}

function qualityScore(game = {}) {
  const vals = [
    game?.quality?.score,
    game?.dataQuality,
    game?.data_quality,
    game?.model?.dataQuality,
    game?.model?.data_quality,
    game?.cfb?.dataQuality,
    game?.cbb?.dataQuality,
  ];
  for (const v of vals) {
    const n = num(v);
    if (Number.isFinite(n)) return clamp100(n);
  }
  return NaN;
}

function decisionTier(game = {}) {
  const tag = String(game?.rec?.tag || "").toUpperCase();
  if (game?.rec) return tag === "CONVICTION" ? "CONVICTION" : "QUALIFIED";
  if (game?.lean) return "LEAN";
  const maturity = String(game?.projectionMaturity || game?.model?.maturity || "").toUpperCase();
  if (maturity === "RESEARCH" || game?.canQualify === false) return "RESEARCH";
  if (game?.qualificationBlocked || game?.projectionUnavailable) return "BLOCKED";
  return hasProjection(game) ? "PASS" : "NO_MODEL";
}

function hardDq(game = {}) {
  const raw = game?.dqState ?? game?.quality?.dqState;
  if (raw === true) return true;
  return HARD_DQ_STATES.has(String(raw || "").toUpperCase());
}

function genericScore(game = {}) {
  const q = qualityScore(game);
  if (Number.isFinite(q)) return { score: q, source: "QUALITY_SCORE" };
  const tier = decisionTier(game);
  return { score: TIER_SCORE_FALLBACK[tier] ?? 48, source: `TIER_${tier || "UNKNOWN"}` };
}

function cfbScore(game = {}) {
  if (String(game?.sport || "").toLowerCase() !== "cfb") return null;
  const state = String(
    game?.cfb?.projectionState ||
      game?.projectionState ||
      game?.quality?.state ||
      ""
  ).toUpperCase();
  const q = qualityScore(game);
  const stateScore = CFB_STATE_SCORE[state];
  if (!Number.isFinite(stateScore)) return null;
  // Projection state is primary. Strong data quality can elevate a COMPLETE/PARTIAL
  // projection, but operational market flags cannot collapse an otherwise usable
  // independent projection.
  const score = Number.isFinite(q) ? Math.max(stateScore, 0.75 * stateScore + 0.25 * q) : stateScore;
  return { score: clamp100(score), source: `CFB_STATE_${state}` };
}

function soccerScore(game = {}) {
  if (String(game?.sport || "").toLowerCase() !== "soccer") return null;
  const direct = num(
    game?.soccerConfidence?.score ??
      game?.confidencePick?.score ??
      game?.soccerFbis?.confidencePick?.score
  );
  if (Number.isFinite(direct)) return { score: clamp100(direct), source: "SOCCER_CONFIDENCE_SCORE" };
  return null;
}

function nflScore(game = {}) {
  if (String(game?.sport || "").toLowerCase() !== "nfl") return null;
  const pro = game?.nflProShadow || game?.challengers?.["NFL-PRO-v1"];
  const coverage = num(pro?.coverage?.share);
  if (!pro?.ok || !Number.isFinite(coverage)) return null;

  const home = num(pro?.home ?? pro?.projectedHome);
  const away = num(pro?.away ?? pro?.projectedAway);
  const margin = Number.isFinite(home) && Number.isFinite(away) ? home - away : NaN;
  const fairHomeSpread = Number.isFinite(margin) ? -margin : NaN;
  const total = Number.isFinite(home) && Number.isFinite(away) ? home + away : NaN;

  const marketSpread = num(
    game?.market?.execution?.spread ??
      game?.market?.consensus?.spread ??
      game?.market?.reference?.spread ??
      game?.odds?.spread ??
      game?.odds?.pinSpread
  );
  const marketTotal = num(
    game?.market?.execution?.total ??
      game?.market?.consensus?.total ??
      game?.market?.reference?.total ??
      game?.odds?.total ??
      game?.odds?.pinTotal
  );

  const spreadGap =
    Number.isFinite(fairHomeSpread) && Number.isFinite(marketSpread)
      ? Math.abs(fairHomeSpread - marketSpread)
      : NaN;
  const totalGap =
    Number.isFinite(total) && Number.isFinite(marketTotal)
      ? Math.abs(total - marketTotal)
      : NaN;

  const q = qualityScore(game);
  const quality = Number.isFinite(q) ? clamp01(q / 100) : 0.65;
  const sigmaMargin = num(pro?.sigmaMargin);
  const sigmaTotal = num(pro?.sigmaTotal);
  const uncertaintySignal =
    Number.isFinite(sigmaMargin) && Number.isFinite(sigmaTotal)
      ? clamp01(1 - (((sigmaMargin - 13.8) / 7) * 0.6 + ((sigmaTotal - 12.8) / 7) * 0.4))
      : 0.55;
  const edgeSignal = Math.max(
    Number.isFinite(spreadGap) ? clamp01(spreadGap / 7) : 0,
    Number.isFinite(totalGap) ? clamp01(totalGap / 10) : 0
  );

  const availabilityPenalty =
    game?.availabilityImpact?.criticalUnresolved || game?.availabilityImpact?.stale ? 0.12 : 0;

  // Projection-confidence only. Qualification and wager authorization are separate.
  // v2 re-centers the scale so strong, complete NFL projections can actually occupy
  // the 4-5 star bands without creating a daily quota for them.
  const raw =
    100 *
    clamp01(
      0.35 * clamp01(coverage) +
        0.25 * quality +
        0.20 * uncertaintySignal +
        0.20 * edgeSignal -
        availabilityPenalty
    );

  // The old display thresholds made the upper bands operationally unreachable.
  // Re-scale the bounded composite to the shared 0-100 confidence scale.
  return { score: clamp100(18 + raw * 1.08), source: "NFL_PRO_COMPOSITE" };
}

export function canonicalProjectionConfidence(game = {}) {
  if (!hasProjection(game)) {
    return { version: CONFIDENCE_VERSION, score: 20, stars: 1, source: "NO_PROJECTION" };
  }
  if (hardDq(game)) {
    return { version: CONFIDENCE_VERSION, score: 20, stars: 1, source: "HARD_DQ" };
  }

  const sportSpecific =
    nflScore(game) ||
    cfbScore(game) ||
    soccerScore(game);

  const resolved = sportSpecific || genericScore(game);
  const score = clamp100(resolved.score);
  return {
    version: CONFIDENCE_VERSION,
    score: Math.round(score * 10) / 10,
    stars: starsFromScore(score),
    source: resolved.source,
  };
}

export function canonicalConfidenceStars(game = {}) {
  return canonicalProjectionConfidence(game).stars;
}
