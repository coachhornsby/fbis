import { buildBoardGameViewModel } from "./boardViewModel.js";

const TIER_FALLBACK = Object.freeze({
  CONVICTION: 5,
  QUALIFIED: 4,
  LEAN: 3,
  WATCH: 3,
  PASS: 2,
  RESEARCH: 2,
  BLOCKED: 2,
  NO_MODEL: 1,
});

const CFB_STATE_STARS = Object.freeze({
  COMPLETE: 4,
  PARTIAL: 3,
  PRIOR_ONLY: 2,
  PROVISIONAL: 2,
  LEAGUE_AVERAGE_ONLY: 1,
  UNAVAILABLE: 1,
  NO_MODEL: 1,
});

const HARD_DQ_STATES = new Set([
  "DQ",
  "BLOCKED",
  "INVALID",
  "FAILED",
  "REJECTED",
  "CORRUPT",
]);

function numericQuality(value) {
  if (value == null || value === "") return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function starsFromQuality(q) {
  if (!Number.isFinite(q)) return null;
  if (q >= 90) return 5;
  if (q >= 80) return 4;
  if (q >= 68) return 3;
  if (q >= 55) return 2;
  return 1;
}

function hardDataDisqualification(vm) {
  const raw = vm?.decision?.dqState;
  if (raw === true) return true;
  const state = String(raw || "").toUpperCase();
  return HARD_DQ_STATES.has(state);
}

function cfbStateStars(game, vm) {
  if (String(vm?.sport || game?.sport || "").toLowerCase() !== "cfb") return null;
  const state = String(
    game?.cfb?.projectionState ||
      game?.projectionState ||
      vm?.projection?.state ||
      ""
  ).toUpperCase();
  if (!state) return null;
  return CFB_STATE_STARS[state] ?? null;
}

function soccerCompositeStars(game, vm) {
  if (String(vm?.sport || game?.sport || "").toLowerCase() !== "soccer") return null;
  const explicit = numericQuality(
    game?.soccerConfidence?.stars ??
    game?.confidencePick?.stars ??
    game?.soccerFbis?.confidencePick?.stars ??
    game?.model?.confidenceStars
  );
  if (!Number.isFinite(explicit)) return null;
  return Math.max(1, Math.min(5, Math.round(explicit)));
}

function nflCompositeStars(game, vm, q) {
  if (String(vm?.sport || game?.sport || "").toLowerCase() !== "nfl") return null;
  const pro = game?.nflProShadow || game?.challengers?.["NFL-PRO-v1"];
  const coverage = numericQuality(pro?.coverage?.share);
  if (!pro?.ok || !Number.isFinite(coverage)) return null;

  const quality = Number.isFinite(q) ? Math.max(0, Math.min(1, q / 100)) : 0.65;
  const proHome = numericQuality(pro?.home ?? pro?.projectedHome);
  const proAway = numericQuality(pro?.away ?? pro?.projectedAway);
  const fairHomeSpread =
    Number.isFinite(proHome) && Number.isFinite(proAway) ? -(proHome - proAway) : NaN;
  const proTotal =
    Number.isFinite(proHome) && Number.isFinite(proAway) ? proHome + proAway : NaN;
  const marketSpread = numericQuality(vm?.market?.spread);
  const marketTotal = numericQuality(vm?.market?.total);
  const spread = Math.abs(
    Number.isFinite(fairHomeSpread) && Number.isFinite(marketSpread)
      ? fairHomeSpread - marketSpread
      : Number(vm?.comparison?.spreadDelta)
  );
  const total = Math.abs(
    Number.isFinite(proTotal) && Number.isFinite(marketTotal)
      ? proTotal - marketTotal
      : Number(vm?.comparison?.totalDelta)
  );
  const edgeSignal = Math.max(
    Number.isFinite(spread) ? Math.min(1, spread / 7) : 0,
    Number.isFinite(total) ? Math.min(1, total / 10) : 0
  );

  const sigmaMargin = numericQuality(pro?.sigmaMargin);
  const sigmaTotal = numericQuality(pro?.sigmaTotal);
  const uncertaintySignal =
    Number.isFinite(sigmaMargin) && Number.isFinite(sigmaTotal)
      ? Math.max(
          0,
          Math.min(
            1,
            1 - (((sigmaMargin - 13.8) / 7) * 0.6 + ((sigmaTotal - 12.8) / 7) * 0.4)
          )
        )
      : 0.55;

  const availabilityPenalty =
    game?.availabilityImpact?.criticalUnresolved || game?.availabilityImpact?.stale ? 0.12 : 0;

  const score =
    100 *
    Math.max(
      0,
      Math.min(
        1,
        0.35 * Math.max(0, Math.min(1, coverage)) +
          0.25 * quality +
          0.20 * uncertaintySignal +
          0.20 * edgeSignal -
          availabilityPenalty
      )
    );

  if (score >= 78) return 5;
  if (score >= 60) return 4;
  if (score >= 48) return 3;
  if (score >= 36) return 2;
  return 1;
}

/**
 * Projection-confidence stars.
 *
 * Stars measure confidence in the projection itself. Qualification / authorization
 * remains a separate governance concern surfaced by board badges. A projection
 * that is research-only or not wager-authorized is not automatically a 1-star
 * projection.
 */
export function confidenceStars(game) {
  const canonical = numericQuality(game?.confidenceStars ?? game?.displayConfidenceStars);
  if (Number.isFinite(canonical) && canonical >= 1 && canonical <= 5) {
    return Math.max(1, Math.min(5, Math.round(canonical)));
  }

  const vm = buildBoardGameViewModel(game);

  if (!vm.projection?.available) return 1;
  if (hardDataDisqualification(vm)) return 1;

  const tier = String(vm.decision?.tier || "").toUpperCase();
  const qualification = String(vm.decision?.qualification || "").toUpperCase();
  const q = numericQuality(vm.quality?.score);

  let stars = cfbStateStars(game, vm);
  if (stars == null) stars = soccerCompositeStars(game, vm);
  if (stars == null) stars = nflCompositeStars(game, vm, q);
  if (stars == null) stars = starsFromQuality(q);
  if (stars == null) stars = TIER_FALLBACK[tier] || 2;

  // For CFB, projection state is the primary confidence signal. The generic
  // board quality score includes operational/reference-market flags and must
  // not collapse an otherwise usable model projection to 1 star.
  if (String(vm.sport || "").toLowerCase() === "cfb") {
    if (Number.isFinite(q) && q >= 90) stars = Math.max(stars, 5);
    else if (Number.isFinite(q) && q >= 80) stars = Math.max(stars, 4);
    else if (Number.isFinite(q) && q >= 68) stars = Math.max(stars, 3);
  }

  // Missing quality falls back to the decision tier instead of becoming zero.
  if (!Number.isFinite(q)) {
    if (qualification === "QUALIFIED") stars = Math.max(stars, 4);
    if (tier === "CONVICTION") stars = 5;
  }

  // Governance labels do not determine projection confidence. Research-only,
  // blocked, or non-authorized status stays in badges/authority fields and
  // must not cap the star rating.

  return Math.max(1, Math.min(5, stars));
}

export function sortByConfidence(games = []) {
  return [...games].sort((a, b) => {
    const starDiff = confidenceStars(b) - confidenceStars(a);
    if (starDiff) return starDiff;

    const rawQa = buildBoardGameViewModel(a).quality?.score;
    const rawQb = buildBoardGameViewModel(b).quality?.score;
    const qa = numericQuality(rawQa);
    const qb = numericQuality(rawQb);
    if (Number.isFinite(qa) || Number.isFinite(qb)) {
      const qualityDiff =
        (Number.isFinite(qb) ? qb : -1) - (Number.isFinite(qa) ? qa : -1);
      if (qualityDiff) return qualityDiff;
    }

    const ta =
      Date.parse(a?.start || a?.startTime || "") || Number.POSITIVE_INFINITY;
    const tb =
      Date.parse(b?.start || b?.startTime || "") || Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}
