import nflPropMarketCalibration from "./nflPropCalibrationArtifact.js";

/**
 * Selective FBIS player-prop portfolio.
 *
 * Objective: publish a small daily set of the strongest independent model
 * disagreements, not maximize projection coverage. Market lines are comparison
 * targets only; they are never projection inputs.
 */
export const MLB_PITCHER_K_CANDIDATE_EDGE = Object.freeze({
  minAbsoluteKs: 0.75,
  lockedAt: "2026-10-05",
  status: "PROSPECTIVE_LOCK",
});

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function nflPropMarketCalibrationState(row = {}) {
  const sport=String(row.sport||row.league||"").trim().toLowerCase();
  if(sport!=="nfl")return null;
  const market=String(row.market||row.canonicalMarket||row.canonical_market||row.statType||"").trim().toLowerCase();
  const evidence=nflPropMarketCalibration?.markets?.[market]||null;
  return {
    market,
    version:nflPropMarketCalibration?.calibrationVersion||"NFL-PROP-MARKET-CAL-v2",
    evidence,
    validated:evidence?.validated===true,
    maxStars:evidence?.validated===true?5:3,
    reason:evidence?.validated===true?null:(evidence?.reason||"market_specific_calibration_not_validated"),
  };
}

export function propCalibrationValidated(row = {}) {
  const explicit =
    row.propCalibrationValidated === true ||
    row.prop_calibration_validated === true ||
    row.probabilityCalibrationValidated === true ||
    row.probability_calibration_validated === true ||
    row.marketCalibrationValidated === true ||
    row.market_calibration_validated === true;

  // NFL requires BOTH row-level calibrated probability evidence and a
  // market-specific validation record. A raw z-score can never opt itself into
  // 4★/5★ confidence.
  const nfl=nflPropMarketCalibrationState(row);
  if(nfl){
    if(!nfl.validated)return false;
    if(explicit)return true;
    const calibrated=finite(row.calibratedHitProbability??row.calibrated_hit_probability);
    return calibrated!=null&&calibrated>0&&calibrated<1;
  }

  if (explicit) return true;
  const calibrated = finite(row.calibratedHitProbability ?? row.calibrated_hit_probability);
  return calibrated != null && calibrated > 0 && calibrated < 1;
}

/**
 * Platform-wide guardrail: a raw projection gap or z-score is not enough to
 * support PREMIUM/ELITE prop confidence. Until the market-specific mapping from
 * model edge to realized hit probability is explicitly validated, props are
 * capped at 3★. Sport-specific validated graders may opt in by attaching an
 * explicit calibration flag/probability before this ceiling is applied.
 */
export function applyPropCalibrationCeiling(row = {}, stars = 1) {
  const value = clamp(Number(stars) || 1, 1, 5);
  return propCalibrationValidated(row) ? value : Math.min(value, 3);
}

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

function prizePicksTier(row = {}) {
  return String(row.oddsTier ?? row.odds_tier ?? "standard").trim().toLowerCase() || "standard";
}

function explicitBreakEvenProbability(row = {}) {
  let be = finite(
    row.payoutBreakEvenProbability ??
    row.payout_break_even_probability ??
    row.breakEvenProbability ??
    row.break_even_probability
  );
  if (be == null) return null;
  if (be > 1 && be <= 100) be /= 100;
  return be > 0 && be < 1 ? be : null;
}

export function prizePicksTierEconomics(row = {}, hitProbability = null) {
  if (/kalshi|polymarket/i.test(String(row.executionVenue||row.venue||row.source||""))) return {tier:"exchange",alternate:false,rankingEligible:true,maxStars:5,status:"EXCHANGE_CONTRACT_PRICE",payoutAdjusted:false,payoutPriced:false,comparableToStandard:false};
  const tier = prizePicksTier(row);
  const alternate = tier === "demon" || tier === "goblin";
  if (!alternate) {
    return {
      tier,
      alternate:false,
      payoutAdjusted:false,
      payoutPriced:false,
      breakEvenProbability:null,
      probabilityEdge:null,
      comparableToStandard:true,
      rankingEligible:true,
      maxStars:5,
      status:"STANDARD_LINE_CALIBRATED",
      reason:null,
    };
  }

  const be = explicitBreakEvenProbability(row);
  const p = finite(hitProbability);
  if (be == null) {
    return {
      tier,
      alternate:true,
      payoutAdjusted:false,
      payoutPriced:false,
      breakEvenProbability:null,
      probabilityEdge:null,
      comparableToStandard:false,
      rankingEligible:false,
      maxStars:2,
      status:"ALTERNATE_TIER_PAYOUT_UNPRICED",
      reason:"alternate-tier-payout-break-even-missing",
    };
  }

  const probabilityEdge = p == null ? null : p - be;
  const calibrationValidated = row.payoutCalibrationValidated === true || row.payout_calibration_validated === true;
  let maxStars = 1;
  if (probabilityEdge != null) {
    maxStars = probabilityEdge >= 0.10 ? 5
      : probabilityEdge >= 0.07 ? 4
        : probabilityEdge >= 0.04 ? 3
          : probabilityEdge >= 0.02 ? 2
            : 1;
  }
  if (!calibrationValidated) maxStars = Math.min(maxStars, 4);

  return {
    tier,
    alternate:true,
    payoutAdjusted:true,
    payoutPriced:true,
    breakEvenProbability:be,
    probabilityEdge,
    comparableToStandard:calibrationValidated,
    rankingEligible:probabilityEdge != null && probabilityEdge > 0,
    maxStars,
    status:calibrationValidated ? "ALTERNATE_TIER_PAYOUT_CALIBRATED" : "ALTERNATE_TIER_PAYOUT_RESEARCH",
    reason:calibrationValidated ? null : "alternate-tier-payout-calibration-not-validated",
  };
}

export function estimatedPropHitProbability(row = {}) {
  const projection = finite(row.fbisProjection ?? row.projection);
  const line = finite(row.line ?? row.marketLine);
  const sigma = finite(row.fbisSigma ?? row.sigma);
  if (projection == null || line == null || sigma == null || sigma <= 0) return null;
  return clamp(normalCdf(Math.abs(projection - line) / sigma), 0.5, 0.999);
}

const RELIABLE_SIGMA_SPORTS = new Set(["nfl","mlb","nhl","wnba","nba","cfb","cbb","tennis"]);

const NFL_PROP_CALIBRATION_V1 = {
  // Historical PrizePicks line validation, Dec 2025-Oct 2026.
  // Conservative caps: 5★ reserved for the clearest replicated segment.
  completions: {
    QB1: {
      LESS: { minZ: 0.50, maxStars: 5, minRole: 0.80, tag: "QB1_COMPLETIONS_LESS" },
      MORE: { minZ: 0.00, maxStars: 4, minRole: 0.80, tag: "QB1_COMPLETIONS_MORE" },
    },
  },
  passing_attempts: {
    QB1: {
      LESS: { minZ: 0.00, maxStars: 4, minRole: 0.80, tag: "QB1_PASS_ATTEMPTS_LESS" },
      MORE: { minZ: 0.00, maxStars: 3, minRole: 0.80, tag: "QB1_PASS_ATTEMPTS_MORE" },
    },
  },
  passing_yards: {
    QB1: {
      LESS: { minZ: 0.50, maxStars: 4, minRole: 0.80, tag: "QB1_PASS_YARDS_LESS" },
      MORE: { minZ: 0.00, maxStars: 2, minRole: 0.80, tag: "QB1_PASS_YARDS_MORE" },
    },
  },
  rushing_yards: {
    RB1: {
      LESS: { minZ: 0.00, maxStars: 4, minRole: 0.75, tag: "RB1_RUSH_YARDS_LESS" },
      MORE: { minZ: 0.00, maxStars: 2, minRole: 0.75, tag: "RB1_RUSH_YARDS_MORE" },
    },
  },
  rushing_attempts: {
    RB1: {
      LESS: { minZ: 0.00, maxStars: 3, minRole: 0.75, tag: "RB1_RUSH_ATTEMPTS_LESS" },
      MORE: { minZ: 0.00, maxStars: 3, minRole: 0.75, tag: "RB1_RUSH_ATTEMPTS_MORE" },
    },
  },
  receiving_yards: {
    WR2: {
      MORE: { minZ: 0.50, maxStars: 4, minRole: 0.75, tag: "WR2_REC_YARDS_MORE" },
      LESS: { minZ: 0.00, maxStars: 3, minRole: 0.75, tag: "WR2_REC_YARDS_LESS" },
    },
    TE1: {
      LESS: { minZ: 0.00, maxStars: 4, minRole: 0.75, tag: "TE1_REC_YARDS_LESS" },
      MORE: { minZ: 0.00, maxStars: 1, minRole: 0.75, tag: "TE1_REC_YARDS_MORE_BLOCK" },
    },
    WR1: {
      MORE: { minZ: 0.50, maxStars: 3, minRole: 0.80, tag: "WR1_REC_YARDS_MORE" },
      LESS: { minZ: 0.00, maxStars: 2, minRole: 0.80, tag: "WR1_REC_YARDS_LESS" },
    },
  },
  receptions: {
    WR2: {
      LESS: { minZ: 0.00, maxStars: 5, minRole: 0.75, tag: "WR2_RECEPTIONS_LESS" },
      MORE: { minZ: 0.00, maxStars: 2, minRole: 0.75, tag: "WR2_RECEPTIONS_MORE" },
    },
    WR1: {
      LESS: { minZ: 0.00, maxStars: 1, minRole: 0.80, tag: "WR1_RECEPTIONS_LESS_BLOCK" },
      MORE: { minZ: 0.00, maxStars: 2, minRole: 0.80, tag: "WR1_RECEPTIONS_MORE" },
    },
    TE1: {
      LESS: { minZ: 0.00, maxStars: 2, minRole: 0.75, tag: "TE1_RECEPTIONS_LESS" },
      MORE: { minZ: 0.00, maxStars: 1, minRole: 0.75, tag: "TE1_RECEPTIONS_MORE_BLOCK" },
    },
  },
};

function nflCalibrationState(row = {}, standardizedEdge = null) {
  if (sportKey(row) !== "nfl") return null;
  const market = String(row.market || row.statType || "").trim().toLowerCase();
  const role = String(row.targetRole || row.featureEvidence?.targetRoleName || "").trim().toUpperCase();
  const projection = finite(row.fbisProjection ?? row.projection);
  const line = finite(row.line ?? row.marketLine);
  const side = projection != null && line != null ? (projection > line ? "MORE" : projection < line ? "LESS" : null) : null;
  const policy = NFL_PROP_CALIBRATION_V1?.[market]?.[role]?.[side] || null;
  if (!policy) return {
    market, role, side, policy:null, allowed:false, maxStars:2, reason:"unvalidated_market_role_side"
  };
  const roleConfidence = finite(row.roleConfidence ?? row.role_confidence);
  const z = standardizedEdge == null ? null : Math.abs(Number(standardizedEdge));
  if (roleConfidence == null || roleConfidence < policy.minRole) {
    return { market, role, side, policy, allowed:false, maxStars:2, reason:"calibration_role_floor" };
  }
  if (policy.minZ > 0 && (z == null || z < policy.minZ)) {
    return { market, role, side, policy, allowed:false, maxStars:2, reason:"calibration_edge_floor" };
  }
  return { market, role, side, policy, allowed:true, maxStars:policy.maxStars, reason:null };
}


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

export function selectivePropRating(row = {}) {
  const limits=[];
  const cap=(value,code,text)=>{limits.push({maxStars:value,code,text});stars=Math.min(stars,value);};
  const projection = finite(row.fbisProjection ?? row.projection);
  const line = finite(row.line ?? row.marketLine);
  if (projection == null || line == null) return {stars:null,limits:[],summary:"Projection or source line is missing."};

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

  const baseStars=stars;
  const evidence = evidenceState(row);
  if (quality < 0.55) cap(2,"data_quality","Player data quality is below the confidence threshold.");
  if (role != null && role < 0.60) cap(2,"role_uncertain","The player role is uncertain.");
  if (uncertainty === "HIGH") cap(2,"high_uncertainty","Projection uncertainty is high.");
  if (["BLOCKED","HOLD"].includes(evidence.gate) || evidence.eligible === false) cap(1,"model_hold","The independent player model has a hold or availability restriction.");

  // High-confidence ratings require an empirical dispersion estimate when the
  // model family supports one. Raw point gaps alone are not conviction.
  if (RELIABLE_SIGMA_SPORTS.has(evidence.sport) && !evidence.sigmaReady) {
    cap(2,"dispersion_missing","An empirical player-variation estimate is missing.");
  }

  // NFL v3 is fail-closed around role + recent-form + matchup evidence,
  // then capped by market/role/direction behavior observed against historical
  // PrizePicks lines.
  if (evidence.sport === "nfl") {
    if (role == null) cap(2,"role_missing","Verified player-role confidence is missing.");
    if (!feature.targetRole) cap(1,"target_role_missing","The player is outside the validated target roles.");
    if (!feature.recent5) cap(2,"recent_form_missing","Recent player-form evidence is missing.");
    if (!feature.positionDefense) cap(3,"position_defense_missing","Position-specific opponent evidence is missing.");
    if (!feature.snapShare) cap(3,"snap_share_missing","Player snap-share evidence is missing.");
    if (stars >= 5 && (role == null || role < 0.80 || !feature.nextGen || !feature.opponentMatchup)) cap(4,"elite_evidence_missing","Five stars require stronger role, tracking and matchup evidence.");

    const z = sigma != null && sigma > 0 ? delta / sigma : null;
    const calibration = /kalshi|polymarket/i.test(String(row.executionVenue||row.venue||row.source||"")) ? null : nflCalibrationState(row, z);
    if (calibration && !calibration.allowed) cap(calibration?.maxStars ?? 2,calibration?.reason||"role_market_unvalidated",calibration?.reason==="calibration_role_floor"?"Role confidence is below the historical threshold for this NFL stat and direction.":calibration?.reason==="calibration_edge_floor"?"The projection gap is below the historical threshold for this NFL role and stat.":"This NFL role, stat and direction have no validated historical segment.");
    else if(calibration) cap(calibration.maxStars,"historical_segment_limit","Historical results limit confidence for this NFL role, stat and direction.");

  }

  // PrizePicks payout-tier economics are platform-wide, not NFL-specific.
  // Demon/Goblin and other alternate lines cannot inherit Standard-equivalent
  // confidence from line distance alone in ANY sport.
  const hitProbability = estimatedPropHitProbability(row);
  const tierEconomics = prizePicksTierEconomics(row, hitProbability);
  if(tierEconomics.maxStars<5) cap(tierEconomics.maxStars,tierEconomics.status,tierEconomics.payoutPriced?"Alternate-line payout evidence limits confidence.":"Goblin/Demon payout break-even is missing; confidence is capped at two stars.");
  if(!propCalibrationValidated(row)) cap(3,"probability_calibration_unvalidated","Market-specific probability calibration has not earned four or five stars.");

  const binding=limits.find(limit=>limit.maxStars===stars && limit.maxStars<=baseStars);
  return {stars,baseStars,standardizedEdge:sigma>0?delta/sigma:null,limits,summary:binding?.text||(baseStars<=2?"The projected edge is small relative to normal player variation.":"The projection gap supports this rating before evidence limits."),calibrationValidated:propCalibrationValidated(row)};
}

export function selectivePropStars(row = {}) { return selectivePropRating(row).stars; }

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
    const nflCalibration = evidence.sport === "nfl" ? nflCalibrationState(row, z) : null;
    const prizePicksEconomics = prizePicksTierEconomics(row, hitProbability);
    const mlbKCandidate = evidence.sport === "mlb" && String(row.position || "").toUpperCase() === "P" && String(row.market || row.statType || "").toLowerCase() === "strikeouts"
      ? {
          threshold: MLB_PITCHER_K_CANDIDATE_EDGE.minAbsoluteKs,
          absoluteEdge: Math.abs(delta),
          qualified: Math.abs(delta) >= MLB_PITCHER_K_CANDIDATE_EDGE.minAbsoluteKs,
          state: Math.abs(delta) >= MLB_PITCHER_K_CANDIDATE_EDGE.minAbsoluteKs ? "PROSPECTIVE_CANDIDATE" : "TRACK_ONLY",
        }
      : null;
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
      nflCalibration,
      nflMarketCalibration: evidence.sport === "nfl" ? nflPropMarketCalibrationState(row) : null,
      prizePicksEconomics,
      mlbKCandidate,
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
    if (row.evidenceState?.sport === "mlb" && String(row.position || "").toUpperCase() === "P" && String(row.market || row.statType || "").toLowerCase() === "strikeouts") {
      if (!row.mlbKCandidate?.qualified) return false;
    }
    if (row.evidenceState?.sport === "nfl") {
      if (row.evidenceState?.role == null || row.evidenceState.role < minRoleConfidence) return false;
      if (!row.featureEvidence?.targetRole || !row.featureEvidence?.recent5) return false;
      if (!row.nflCalibration?.allowed && row.confidenceStars >= 3) return false;
      if (row.nflCalibration?.policy?.maxStars === 1) return false;
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
      nflMarketCalibration: nflPropMarketCalibration?.calibrationVersion || "NFL-PROP-MARKET-CAL-v2",
      mlbPitcherKCandidateEdge: MLB_PITCHER_K_CANDIDATE_EDGE.minAbsoluteKs,
      mlbPitcherKCandidateLockedAt: MLB_PITCHER_K_CANDIDATE_EDGE.lockedAt,
    },
  };
}
