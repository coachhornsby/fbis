import { toDomainTodayBoard } from "../../../functions/lib/fbisDomain.js";
import { probabilityAtThreshold } from "../../../functions/lib/cfbPlayerModel.js";
import {
  PRO_PLAYER_PROP_LABELS,
  PRO_PLAYER_PROP_MARKETS,
  PRO_PLAYER_PROP_SPORTS,
  canonicalizeProPlayerPropMarket,
  normalizeProPropSport,
} from "../../../functions/lib/proPlayerProps.js";
import {
  rateGenericNhlPropConfidence,
  rateNhlGoalieSavesConfidence,
  rateNhlShotsOnGoalConfidence,
  nhlPropConfidenceLineValidated,
} from "../../../functions/lib/nhlPropConfidence.js";
import { evaluateNhlPropWagerV1 } from "../../../functions/lib/nhlWagerV1.js";
import { applyPropCalibrationCeiling, estimatedPropHitProbability, prizePicksTierEconomics, selectivePropStars } from "../../../functions/lib/selectivePropEdge.js";

/**
 * All player-prop markets currently supported on FBIS product surfaces.
 * PrizePicks payout/tier rules are platform-level and apply regardless of sport.
 */
export const FBIS_PLAYER_MARKETS = Object.freeze([
  ...new Set(PRO_PLAYER_PROP_SPORTS.flatMap((sport) => PRO_PLAYER_PROP_MARKETS[sport] || [])),
]);

/** Human-readable labels — never show snake_case in the product UI. */
export const MARKET_LABELS = Object.freeze({ ...PRO_PLAYER_PROP_LABELS });

/**
 * Generic raw projection-gap confidence from FBIS projection vs market line.
 * This path is intentionally capped at 3★ because z-distance / relative gap is
 * not a calibrated hit-probability mapping. Validated sport/market graders may
 * unlock 4★/5★ through the shared calibration contract.
 */
export function propProjectionStars(row = {}) {
  const projectionRaw = row.fbisProjection ?? row.fbis_projection ?? row.projection ?? null;
  const lineRaw = row.line ?? null;
  if (
    projectionRaw == null ||
    lineRaw == null ||
    !Number.isFinite(Number(projectionRaw)) ||
    !Number.isFinite(Number(lineRaw))
  ) return null;

  const projection = Number(projectionRaw);
  const line = Number(lineRaw);
  const delta = Math.abs(projection - line);
  const sigmaRaw = row.fbisSigma ?? row.fbis_sigma ?? row.sigma ?? null;
  const sigma = sigmaRaw == null || sigmaRaw === "" ? NaN : Number(sigmaRaw);

  if (Number.isFinite(sigma) && sigma > 0) {
    const z = delta / sigma;
    if (z >= 0.40) return 3;
    if (z >= 0.20) return 2;
    return 1;
  }

  const relativeGap = delta / Math.max(Math.abs(line), 1);
  if (relativeGap >= 0.06) return 3;
  if (relativeGap >= 0.03) return 2;
  return 1;
}

/**
 * Attach FBIS projection analytics when upstream provided them.
 * May derive over/under probability from projection + sigma + line only —
 * never invents a projection or price.
 */
function applyPrizePicksPlatformConfidence(row = {}, stars = 1, opts = {}) {
  const hitProbability = estimatedPropHitProbability(row);
  const economics = prizePicksTierEconomics(row, hitProbability);
  const calibrationRow = opts.calibrationValidated === true
    ? { ...row, propCalibrationValidated: true }
    : row;
  return {
    stars: applyPropCalibrationCeiling(
      calibrationRow,
      Math.min(Number(stars) || 1, economics.maxStars),
    ),
    economics,
  };
}

export function withFbisPropAnalytics(row = {}) {
  const fbisProjection =
    row.fbisProjection ?? row.projection ?? row.average ?? row.proj ?? null;
  const fbisSigma = row.fbisSigma ?? row.sigma ?? null;
  const line = row.line ?? null;
  let probabilityOver = row.probabilityOver ?? row.pMore ?? null;
  let probabilityUnder = row.probabilityUnder ?? row.pLess ?? null;

  if (
    (probabilityOver == null || probabilityUnder == null) &&
    Number.isFinite(Number(fbisProjection)) &&
    Number.isFinite(Number(fbisSigma)) &&
    Number(fbisSigma) > 0 &&
    Number.isFinite(Number(line))
  ) {
    const derived = probabilityAtThreshold(
      { projection: Number(fbisProjection), sigma: Number(fbisSigma) },
      Number(line),
    );
    probabilityOver = derived.probabilityOver;
    probabilityUnder = derived.probabilityUnder;
  }

  const edge = row.edge ?? row.ev ?? null;
  const projectionDelta =
    fbisProjection != null &&
    line != null &&
    Number.isFinite(Number(fbisProjection)) &&
    Number.isFinite(Number(line))
      ? Number(fbisProjection) - Number(line)
      : null;

  const finiteOrNull = (v) =>
    v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);

  const enriched = {
    ...row,
    fbisProjection: finiteOrNull(fbisProjection),
    fbisSigma: finiteOrNull(fbisSigma),
    probabilityOver: finiteOrNull(probabilityOver),
    probabilityUnder: finiteOrNull(probabilityUnder),
    probability: finiteOrNull(row.probability),
    edge: finiteOrNull(edge),
    projectionDelta,
  };
  const ranked = {
    ...enriched,
    ...rankPropConviction(enriched),
  };

  if (
    String(ranked.sport || "").toLowerCase() === "mlb" &&
    String(ranked.modelMaturity || ranked.maturity || "").toUpperCase() === "RESEARCH_UNVALIDATED"
  ) {
    return {
      ...ranked,
      convictionTier:"WATCH",
      confidenceStars:1,
      confidenceLabel:"1 STAR",
      confidenceTier:"WATCH",
      confidenceSide:ranked.convictionLean || null,
      confidenceGap:ranked.projectionDelta,
      confidenceReasons:["research_unvalidated_pending_historical_backtest"],
      confidenceResearchCandidate:false,
      confidenceVersion:"mlb-research-unvalidated-v1",
    };
  }

  if (String(ranked.sport || "").toLowerCase() === "nhl") {
    if (String(ranked.marketCanonical || ranked.market || "") === "saves") {
      const env = ranked.shotEnvironment || {};
      const stars = rateNhlGoalieSavesConfidence({
        projection: ranked.fbisProjection,
        line: ranked.line,
        opponentShotsFor: env.opponentShotsFor,
        teamShotsAgainst: env.teamShotsAgainst,
        projectedShotsFaced: env.projectedShotsFaced,
        starterConfirmed: ranked.propGate === "CLEAR",
        lineValidated: nhlPropConfidenceLineValidated("saves",ranked.line),
        modelValidated: ranked.validationStatus === "PROMOTE_RESEARCH",
      });
      const platform = applyPrizePicksPlatformConfidence(ranked, stars.stars, {
        calibrationValidated: ranked.validationStatus === "PROMOTE_RESEARCH" && nhlPropConfidenceLineValidated("saves", ranked.line),
      });
      return {
        ...ranked,
        prizePicksEconomics: platform.economics,
        confidenceStars: platform.stars,
        confidenceLabel: `${platform.stars} STAR`,
        confidenceTier: platform.stars >= 5 ? "ELITE" : platform.stars === 4 ? "PREMIUM" : platform.stars === 3 ? "STRONG" : platform.stars === 2 ? "LEAN" : "WATCH",
        confidenceSide: stars.side,
        confidenceGap: stars.gap,
        confidenceReasons: stars.reasons,
        confidenceResearchCandidate: stars.researchCandidate,
        confidenceVersion: stars.confidenceVersion,
        confidenceEnvironment: stars.environment,
      };
    }

    if (String(ranked.marketCanonical || ranked.market || "") === "shots_on_goal") {
      const env = ranked.shotEnvironment || {};
      const stars = rateNhlShotsOnGoalConfidence({
        projection: ranked.fbisProjection,
        line: ranked.line,
        teamShotsFor: env.teamShotsFor,
        opponentShotsAgainst: env.opponentShotsAgainst,
        projectedTeamShots: env.projectedTeamShots,
        playerShotRate: env.playerShotRate,
        playerShotShare: env.playerShotShare,
        lineValidated: nhlPropConfidenceLineValidated("shots_on_goal",ranked.line),
        modelValidated: ranked.validationStatus === "PROMOTE_RESEARCH",
      });
      const platform = applyPrizePicksPlatformConfidence(ranked, stars.stars, {
        calibrationValidated: ranked.validationStatus === "PROMOTE_RESEARCH" && nhlPropConfidenceLineValidated("shots_on_goal", ranked.line),
      });
      return {
        ...ranked,
        prizePicksEconomics: platform.economics,
        confidenceStars: platform.stars,
        confidenceLabel: `${platform.stars} STAR`,
        confidenceTier: platform.stars >= 5 ? "ELITE" : platform.stars === 4 ? "PREMIUM" : platform.stars === 3 ? "STRONG" : platform.stars === 2 ? "LEAN" : "WATCH",
        confidenceSide: stars.side,
        confidenceGap: stars.gap,
        confidenceReasons: stars.reasons,
        confidenceResearchCandidate: stars.researchCandidate,
        confidenceVersion: stars.confidenceVersion,
        confidenceEnvironment: stars.environment,
      };
    }

    const genericStars = rateGenericNhlPropConfidence({
      market: ranked.marketCanonical || ranked.market,
      projection: ranked.fbisProjection,
      line: ranked.line,
      leanProbability: ranked.leanProbability,
      validationStatus: ranked.validationStatus,
      lineValidationStatus: ranked.lineValidationStatus,
      eligibleForCard: ranked.eligibleForCard,
    });
    if (genericStars) {
      const platform = applyPrizePicksPlatformConfidence(ranked, genericStars.stars, {
        calibrationValidated: ranked.validationStatus === "PROMOTE_RESEARCH" && ranked.lineValidationStatus === "VALIDATED",
      });
      return {
        ...ranked,
        prizePicksEconomics: platform.economics,
        confidenceStars: platform.stars,
        confidenceLabel: `${platform.stars} STAR`,
        confidenceTier: platform.stars >= 5 ? "ELITE" : platform.stars === 4 ? "PREMIUM" : platform.stars === 3 ? "STRONG" : platform.stars === 2 ? "LEAN" : "WATCH",
        confidenceSide: ranked.convictionLean || null,
        confidenceGap: ranked.projectionDelta,
        confidenceReasons: genericStars.reasons,
        confidenceResearchCandidate: genericStars.researchCandidate,
        confidenceVersion: genericStars.confidenceVersion,
      };
    }
  }

  const nflTargetRole = ranked.targetRole || ranked.featureEvidence?.targetRoleName || null;
  let stars = String(ranked.sport || "").toLowerCase() === "nfl" && nflTargetRole
    ? (selectivePropStars({
        ...ranked,
        market: ranked.marketCanonical || ranked.market,
        targetRole: nflTargetRole,
        // Confidence display is independent from wager authorization. Research
        // rows may carry calibrated stars when availability/role evidence is
        // clear, while recommendationEligible/modelAuthorized remain false.
        eligibleForCard: ranked.propGate === "CLEAR",
      }) ?? 1)
    : (propProjectionStars(ranked) ?? 1);
  const roleConfidence = ranked.roleConfidence == null ? null : Number(ranked.roleConfidence);
  if (Number.isFinite(roleConfidence) && roleConfidence < 0.6) stars = Math.min(stars, 2);
  if (ranked.propGate && ranked.propGate !== "CLEAR") stars = Math.min(stars, 2);
  const platform = applyPrizePicksPlatformConfidence(ranked, stars);
  stars = platform.stars;
  const hasSigma = Number.isFinite(Number(ranked.fbisSigma)) && Number(ranked.fbisSigma) > 0;
  return {
    ...ranked,
    prizePicksEconomics: platform.economics,
    confidenceStars: stars,
    confidenceLabel: `${stars} STAR`,
    confidenceTier: stars >= 5 ? "ELITE" : stars === 4 ? "PREMIUM" : stars === 3 ? "STRONG" : stars === 2 ? "LEAN" : "WATCH",
    confidenceSide: ranked.convictionLean || null,
    confidenceGap: ranked.projectionDelta,
    confidenceReasons: [
      hasSigma
        ? "fbis_projection_vs_prizepicks_line_sigma"
        : "fbis_projection_vs_prizepicks_line_relative_gap",
    ],
    confidenceResearchCandidate: stars >= 3,
    confidenceVersion: "fbis-prop-gap-stars-v1",
  };
}

/**
 * Rank mispricing / conviction from real FBIS signals only.
 * Higher convictionScore = more mispriced. No signal → sorts last.
 */
export function rankPropConviction(row = {}) {
  const pOverRaw = row.probabilityOver;
  const pUnderRaw = row.probabilityUnder;
  const edgeRaw = row.edge;
  const deltaRaw = row.projectionDelta;
  const sigmaRaw = row.fbisSigma;
  const projRaw = row.fbisProjection;
  const roleRaw = row.roleConfidence;

  const pOver = pOverRaw == null || pOverRaw === "" ? NaN : Number(pOverRaw);
  const pUnder = pUnderRaw == null || pUnderRaw === "" ? NaN : Number(pUnderRaw);
  const edge = edgeRaw == null || edgeRaw === "" ? NaN : Number(edgeRaw);
  const delta = deltaRaw == null || deltaRaw === "" ? NaN : Number(deltaRaw);
  const sigma = sigmaRaw == null || sigmaRaw === "" ? NaN : Number(sigmaRaw);
  const hasProb = Number.isFinite(pOver) && Number.isFinite(pUnder);
  const hasEdge = Number.isFinite(edge);
  const hasDelta = Number.isFinite(delta);
  const hasProj = projRaw != null && projRaw !== "" && Number.isFinite(Number(projRaw));
  const roleConfidence = roleRaw == null || roleRaw === "" ? null : Number(roleRaw);

  if (!hasProj && !hasProb && !hasEdge) {
    return {
      convictionScore: -1,
      convictionTier: "NONE",
      convictionLean: null,
      leanProbability: null,
      mispricingZ: null,
    };
  }

  let lean = null;
  let leanProbability = null;
  if (hasProb) {
    lean = pOver >= pUnder ? "MORE" : "LESS";
    leanProbability = Math.max(pOver, pUnder);
  } else if (hasDelta && delta !== 0) {
    lean = delta > 0 ? "MORE" : "LESS";
  } else if (hasEdge && edge !== 0) {
    const side = String(row.projectionSide || row.side || "").toUpperCase();
    if (side === "OVER" || side === "MORE") lean = "MORE";
    else if (side === "UNDER" || side === "LESS") lean = "LESS";
    else lean = edge > 0 ? "MORE" : "LESS";
  }

  const mispricingZ =
    hasDelta && Number.isFinite(sigma) && sigma > 0 ? delta / sigma : null;

  const absEdge = hasEdge ? Math.abs(edge > 1 ? edge / 100 : edge) : null;
  const probEdge = leanProbability != null ? Math.max(0, leanProbability - 0.5) : 0;
  const zEdge = mispricingZ != null ? Math.abs(mispricingZ) : 0;

  const reliability = Number.isFinite(roleConfidence) ? Math.max(0.35, Math.min(1, roleConfidence)) : 0.75;
  const convictionScore = (
    probEdge * 200 +
    (absEdge != null ? absEdge * 100 : 0) +
    zEdge * 12
  ) * reliability + (hasProj ? 0.01 : 0);

  let convictionTier = "WATCH";
  if (
    (leanProbability != null && leanProbability >= 0.7) ||
    (absEdge != null && absEdge >= 0.08) ||
    zEdge >= 1
  ) {
    convictionTier = "CONVICTION";
  } else if (
    (leanProbability != null && leanProbability >= 0.62) ||
    (absEdge != null && absEdge >= 0.05) ||
    zEdge >= 0.6
  ) {
    convictionTier = "STRONG";
  } else if (
    (leanProbability != null && leanProbability >= 0.55) ||
    (absEdge != null && absEdge >= 0.03) ||
    zEdge >= 0.35
  ) {
    convictionTier = "LEAN";
  } else if (!hasProj && !hasProb && !hasEdge) {
    convictionTier = "NONE";
  }

  return {
    convictionScore,
    convictionTier,
    convictionLean: lean,
    leanProbability: leanProbability != null ? leanProbability : null,
    mispricingZ,
  };
}

export function sortPropsByConviction(rows = []) {
  return [...(rows || [])].sort((a, b) => {
    const aStars=Number(a?.confidenceStars),bStars=Number(b?.confidenceStars);
    const aStarScore=Number.isFinite(aStars)?aStars:0,bStarScore=Number.isFinite(bStars)?bStars:0;
    if(bStarScore!==aStarScore)return bStarScore-aStarScore;
    const sa = Number(a?.convictionScore);
    const sb = Number(b?.convictionScore);
    const aScore = Number.isFinite(sa) ? sa : -1;
    const bScore = Number.isFinite(sb) ? sb : -1;
    if (bScore !== aScore) return bScore - aScore;
    const nameA = String(a?.playerName || "");
    const nameB = String(b?.playerName || "");
    return nameA.localeCompare(nameB);
  });
}

/**
 * Resolve the player's team identity (logo/abbr/name) from the event sides,
 * falling back to the shared team catalog. Never invents a logo URL.
 */
export function resolvePlayerTeamIdentity(event = {}, teamKey = null) {
  const needle = String(teamKey || "").trim().toLowerCase();
  const sides = [event?.teams?.away, event?.teams?.home].filter(Boolean);
  const match = needle
    ? sides.find((t) => {
        const keys = [t.abbr, t.name, t.school, t.fullName]
          .filter(Boolean)
          .map((v) => String(v).trim().toLowerCase());
        return keys.includes(needle);
      })
    : null;
  if (match?.logoUrl || match?.logo || match?.abbr || match?.name) {
    return {
      abbr: match.abbr || null,
      name: match.name || match.fullName || match.school || null,
      logo: match.logoUrl || match.logo || null,
    };
  }
  if (!teamKey) return { abbr: null, name: null, logo: null };
  return {
    abbr: String(teamKey),
    name: String(teamKey),
    logo: null,
  };
}

export function formatMarketLabel(canonicalOrRaw) {
  if (!canonicalOrRaw) return "Player Prop";
  const key = String(canonicalOrRaw).trim();
  if (MARKET_LABELS[key]) return MARKET_LABELS[key];
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => {
      if (/^(td|qb|rb|wr|te|fg|xp|rbi|rbis|pra)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Map legacy propConvictions → playerMarkets when upstream only has convictions.
 * Same adapter used by Today command center — never invents eligibility.
 */
export function normalizeBoardGame(game = {}) {
  const projections = Array.isArray(game.playerProjectionRows) ? game.playerProjectionRows : [];
  let markets = Array.isArray(game.playerMarkets) ? [...game.playerMarkets] : [];

  if (!markets.length && (game.propConvictions || []).length) {
    markets = (game.propConvictions || []).map((c) => ({
      playerName: c.playerName,
      team: c.team,
      position: c.position,
      market: c.marketLabel || c.market,
      marketCanonical: c.market,
      line: c.line,
      overOdds: c.price,
      book: c.book,
      fbisProjection: c.projection ?? c.average ?? null,
      fbisSigma: c.sigma ?? null,
      probability: c.probability ?? null,
      probabilityOver:
        c.probabilityOver ??
        (String(c.side || "").toUpperCase() === "OVER" ||
        String(c.side || "").toUpperCase() === "MORE"
          ? c.probability
          : null),
      probabilityUnder:
        c.probabilityUnder ??
        (String(c.side || "").toUpperCase() === "UNDER" ||
        String(c.side || "").toUpperCase() === "LESS"
          ? c.probability
          : null),
      edge: c.ev ?? c.edge ?? null,
      decisionEligible: false,
      reasonCodes: ["PROP_CONVICTION_RESEARCH_ONLY"],
    }));
  }

  const sameName = (a,b) => {
    const clean=(v)=>String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    return clean(a) && clean(a)===clean(b);
  };
  const sameProjection = (m,p) => {
    const market =
      canonicalizeProPlayerPropMarket(game.sport, m.marketCanonical || m.market) ||
      m.marketCanonical ||
      null;
    if (market !== p.market) return false;
    if (m.providerPlayerId && p.playerId && String(m.providerPlayerId) === String(p.playerId)) return true;
    if (m.fbisPlayerId && p.playerId && String(m.fbisPlayerId) === String(p.playerId)) return true;
    return sameName(m.playerName,p.playerName) &&
      (!m.team || !p.team || String(m.team).toUpperCase()===String(p.team).toUpperCase());
  };

  const matched = new Set();
  const playerMarkets = markets.map((m)=>{
    const idx=projections.findIndex((p)=>sameProjection(m,p));
    if(idx<0) return m;
    matched.add(idx);
    const p=projections[idx];
    const validatedLines=p.validatedLines&&typeof p.validatedLines==="object"?p.validatedLines:{};
    const hasLineGrid=Object.keys(validatedLines).length>0;
    const lineNumber=Number(m.line);
    const lineKey=Number.isFinite(lineNumber)?String(lineNumber):null;
    const lineValidationStatus=lineKey?validatedLines[lineKey]||"UNVALIDATED_LINE":null;
    const lineValidated=!hasLineGrid||lineValidationStatus==="PROMOTE_RESEARCH";
    return {
      ...m,
      fbisProjection: p.fbisProjection ?? m.fbisProjection ?? null,
      fbisSigma: p.fbisSigma ?? m.fbisSigma ?? null,
      projectionSource: p.source || null,
      modelMaturity: p.maturity || "RESEARCH",
      modelIndependent: p.independent !== false,
      availabilityStatus: p.availabilityStatus || null,
      roleConfidence: p.roleConfidence ?? null,
      snapShare: p.snapShare ?? null,
      targetRole: p.targetRole || p.featureEvidence?.targetRoleName || null,
      featureEvidence: p.featureEvidence ?? null,
      validationStatus:p.validationStatus||null,
      lineValidationStatus,
      shotEnvironment:p.shotEnvironment||null,
      trackingAdvisory:p.trackingAdvisory||null,
      matchupTrackingAdvisory:p.matchupTrackingAdvisory||null,
      propGate: lineValidated ? (p.propGate || "CLEAR") : "HOLD",
      gateReason: lineValidated ? (p.gateReason || null) : "prop_line_not_validated_vs_baseline",
      decisionEligible: p.decisionEligible === true && lineValidated,
      modelAuthorized: p.canAuthorizeWager === true && lineValidated,
      eligibleForCard: p.eligibleForCard === true && lineValidated,
    };
  });

  projections.forEach((p,idx)=>{
    if(matched.has(idx)) return;
    playerMarkets.push({
      providerPlayerId: p.playerId || null,
      fbisPlayerId: p.playerId || null,
      playerName: p.playerName || null,
      team: p.team || null,
      position: p.position || null,
      market: p.market,
      marketCanonical: p.market,
      line: null,
      overOdds: null,
      underOdds: null,
      book: null,
      fbisProjection: p.fbisProjection ?? null,
      fbisSigma: p.fbisSigma ?? null,
      projectionSource: p.source || null,
      modelMaturity: p.maturity || "RESEARCH",
      modelIndependent: p.independent !== false,
      availabilityStatus: p.availabilityStatus || null,
      roleConfidence: p.roleConfidence ?? null,
      snapShare: p.snapShare ?? null,
      targetRole: p.targetRole || p.featureEvidence?.targetRoleName || null,
      featureEvidence: p.featureEvidence ?? null,
      trackingAdvisory: p.trackingAdvisory || null,
      matchupTrackingAdvisory: p.matchupTrackingAdvisory || null,
      propGate: p.propGate || "CLEAR",
      gateReason: p.gateReason || null,
      eligibleForCard: p.eligibleForCard === true,
      decisionEligible: p.decisionEligible === true,
      modelAuthorized: p.canAuthorizeWager === true,
      reasonCodes: [
        "NO_MARKET_LINE_ATTACHED",
        ...(p.propGate && p.propGate !== "CLEAR" ? ["AVAILABILITY_" + p.propGate] : []),
      ],
    });
  });

  return {
    ...game,
    playerMarkets,
  };
}

/**
 * Build the Player Props board from a today board payload.
 * Player props are intentionally limited to MLB/NFL/NBA/NHL.
 * Never invents rows, prices, or decision eligibility.
 */
const NFL_TARGET_ROLES = new Set(["QB1","RB1","WR1","WR2","TE1"]);

function is49ersRoleProjection(row = {}) {
  if (String(row.sport || "").toLowerCase() !== "nfl") return false;
  const team = String(row.teamIdentity?.abbr || row.team || "").trim().toUpperCase();
  const teamName = String(row.teamIdentity?.name || row.team || "").trim().toLowerCase();
  const is49ers = team === "SF" || team === "SFO" || teamName.includes("san francisco") || teamName.includes("49ers");
  const role = String(row.targetRole || row.featureEvidence?.targetRoleName || "").trim().toUpperCase();
  return is49ers && NFL_TARGET_ROLES.has(role);
}

function nflBoardVisible(row = {}) {
  if (String(row.sport || "").toLowerCase() !== "nfl") return true;
  if (is49ersRoleProjection(row)) return true;
  return Number(row.confidenceStars || 0) >= 4;
}

/**
 * Source-only mirror references remain visible when no independent FBIS player
 * projection is available. They never enter the modeled selection list.
 */
export function selectFreeMirrorReferenceRows(rows = [], { sportFilter = "all", limit = 80 } = {}) {
  const sport = String(sportFilter || "all").toLowerCase();
  const max = Math.max(1, Math.min(250, Number(limit) || 80));
  return rows.filter(row => row?.provider === "PRIZEPICKS_FREE_MIRROR" &&
    (sport === "all" || String(row.sport || "").toLowerCase() === sport) &&
    row.line != null && Number.isFinite(Number(row.line)) &&
    row.playerName && (row.marketCanonical || row.market))
    .sort((a,b) => Date.parse(b.sourceObservedAt || b.collectedAt || 0) -
      Date.parse(a.sourceObservedAt || a.collectedAt || 0) ||
      String(a.playerName).localeCompare(String(b.playerName)))
    .slice(0,max)
    .map(row => ({ ...row, displayMode:"MIRROR_REFERENCE_ONLY",
      decisionEligible:false, canQualify:false, canAuthorizeWager:false,
      recommendationEligible:false, modelAuthorized:false }));
}

export function buildPlayerPropsBoard(board = {}, opts = {}) {
  const sportFilter = opts.sportFilter || "all";
  const rawGames = Array.isArray(board?.games)
    ? board.games
    : (board?.groups || []).flatMap((g) => g.games || []);
  const domain = toDomainTodayBoard(
    {
      date: board?.date || opts.date || null,
      games: rawGames.map(normalizeBoardGame),
      counts: board?.counts,
    },
    {
      sportFilter,
      date: board?.date || opts.date || null,
      generatedAt: board?.domain?.generatedAt || opts.generatedAt || null,
    },
  );

  const allRows = [];
  for (const event of domain.events || []) {
    const sport = normalizeProPropSport(event.sport || event.league);
    if (!sport) continue;
    for (const pm of event.playerMarkets || []) {
      const canonical =
        canonicalizeProPlayerPropMarket(sport, pm.marketCanonical || pm.market) ||
        pm.marketCanonical ||
        null;
      const supportedMarket = Boolean(
        canonical && (PRO_PLAYER_PROP_MARKETS[sport] || []).includes(canonical),
      );
      const teamIdentity = resolvePlayerTeamIdentity(event, pm.team);
      const analyzed = withFbisPropAnalytics({
          ...pm,
          marketCanonical: canonical,
          eventId: event.id,
          sport,
          league: event.league,
          startCt: event.startCt,
          matchup: {
            away: event.teams?.away?.abbr || event.teams?.away?.name || null,
            home: event.teams?.home?.abbr || event.teams?.home?.name || null,
          },
          teamIdentity,
          supportedMarket,
          surfaceStatus: pm.propGate === "BLOCKED" ? "BLOCKED" : pm.propGate === "HOLD" ? "HOLD" : pm.decisionEligible ? "QUALIFIED" : "RESEARCH",
          modelAuthorized: pm.modelAuthorized === true || (sport === "wnba" && pm.decisionEligible === true),
          eligibleForCard: pm.propGate === "CLEAR" && pm.eligibleForCard === true,
        });
      allRows.push(sport === "nhl" ? {...analyzed, nhlWagerV1:evaluateNhlPropWagerV1(analyzed)} : analyzed);
    }
  }

  const byMarket = Object.fromEntries(FBIS_PLAYER_MARKETS.map((id) => [id, 0]));
  for (const r of allRows) {
    if (r.marketCanonical && byMarket[r.marketCanonical] != null) {
      byMarket[r.marketCanonical] += 1;
    }
  }

  // General product contract: visible props need an FBIS projection and a
  // comparable market line. Exceptions: MLB persistent model projections and
  // all 49ers target-role projections remain visible before a market line is
  // attached. Line-less rows are informational only and cannot be recommended.
  const projectionRows = allRows.filter(
    (r) =>
      r.fbisProjection != null &&
      Number.isFinite(Number(r.fbisProjection)) &&
      (String(r.sport || "").toLowerCase() !== "tennis" || Boolean(r.imageUrl)),
  );
  const projectedRows = projectionRows.filter(
    (r) =>
      (r.line != null && Number.isFinite(Number(r.line))) ||
      String(r.sport || "").toLowerCase() === "mlb" ||
      is49ersRoleProjection(r),
  );
  const supportedRows = projectedRows.filter((r) => r.supportedMarket || is49ersRoleProjection(r));
  const scopedBase = opts.supportedOnly === false ? projectedRows : supportedRows;
  const scoped = opts.enforceNflDisplayPolicy === true
    ? scopedBase.filter(nflBoardVisible)
    : scopedBase;
  const rows = sortPropsByConviction(scoped).map((r) => {
    const hasLine = r.line != null && Number.isFinite(Number(r.line));
    const mlbProjectionOnly = String(r.sport || "").toLowerCase() === "mlb" && !hasLine;
    return {
      ...r,
      displayMode: mlbProjectionOnly
        ? "MODEL_PROJECTION"
        : is49ersRoleProjection(r) && Number(r.confidenceStars || 0) < 4
          ? "TEAM_PROJECTION"
          : "QUALIFIED_EDGE",
      recommendationEligible: mlbProjectionOnly
        ? false
        : String(r.sport || "").toLowerCase() !== "nfl"
          ? r.eligibleForCard === true
          : Number(r.confidenceStars || 0) >= 4 && r.eligibleForCard === true,
    };
  });
  const rankedAllRows = sortPropsByConviction(projectedRows);

  return {
    date: domain.date,
    generatedAt: domain.generatedAt,
    sportFilter,
    rows,
    allRows: rankedAllRows,
    counts: {
      rows: rows.length,
      eventsWithProps: new Set(rows.map((r) => r.eventId).filter(Boolean)).size,
      supportedRows: supportedRows.length,
      unsupportedRows: projectedRows.length - supportedRows.length,
      hiddenWithoutProjection: allRows.filter((r) => r.fbisProjection == null || !Number.isFinite(Number(r.fbisProjection))).length,
      hiddenTennisWithoutHeadshot: allRows.filter((r) => String(r.sport || "").toLowerCase() === "tennis" && !r.imageUrl).length,
      hiddenNflBelowFourStars: opts.enforceNflDisplayPolicy === true
        ? scopedBase.filter((r) =>
            String(r.sport || "").toLowerCase() === "nfl" &&
            !is49ersRoleProjection(r) &&
            Number(r.confidenceStars || 0) < 4
          ).length
        : 0,
      visible49ersRoleProjections: rows.filter(is49ersRoleProjection).length,
      visibleMlbProjectionOnly: rows.filter((r)=>String(r.sport||"").toLowerCase()==="mlb" && (r.line==null || !Number.isFinite(Number(r.line)))).length,
      byMarket,
      decisionEligible: rows.filter((r) => r.decisionEligible).length,
      cardEligible: rows.filter((r) => r.eligibleForCard === true).length,
      availabilityHold: rows.filter((r) => r.propGate === "HOLD").length,
      availabilityBlocked: rows.filter((r) => r.propGate === "BLOCKED").length,
    },
    readiness: {
      classification: rows.some((r) => r.modelAuthorized === true) ? "ACTIVE" : "RESEARCH_READY",
      modelAuthorized: rows.some((r) => r.modelAuthorized === true),
      decisionEligible: rows.some((r) => r.decisionEligible === true),
      note: rows.some((r) => r.modelAuthorized === true)
        ? "Authorized player-prop rows may be used for card construction; model and market evidence remain visible."
        : "Player props remain research-only for sports/markets without authority.",
    },
    policy: {
      nflMinimumStars: 4,
      nflBelowFourHidden: true,
      fortyNinersTargetRolesAlwaysVisible: ["QB1","RB1","WR1","WR2","TE1"],
      fortyNinersLowStarRowsInformationalOnly: true,
      mlbProjectionOnlyRowsVisible: true,
      mlbProjectionOnlyRowsInformationalOnly: true,
    },
    schemaVersion: "fbis-player-props-board-v2.1",
  };
}

export function groupPlayerPropRows(rows = []) {
  const byPlayer = new Map();
  for (const row of rows || []) {
    const key =
      row.fbisPlayerId ||
      row.providerPlayerId ||
      `${row.playerName || "unknown"}|${row.team || ""}|${row.eventId || ""}`;
    if (!byPlayer.has(key)) {
      byPlayer.set(key, {
        key,
        fbisPlayerId: row.fbisPlayerId || null,
        providerPlayerId: row.providerPlayerId || null,
        playerName: row.playerName || null,
        team: row.team || null,
        teamIdentity: row.teamIdentity || null,
        position: row.position || null,
        imageUrl: row.imageUrl || null,
        imageSource: row.imageSource || null,
        sport: row.sport || null,
        eventId: row.eventId || null,
        matchup: row.matchup || null,
        playerIdentityConfidence: row.playerIdentityConfidence || "UNKNOWN",
        markets: [],
      });
    }
    byPlayer.get(key).markets.push(row);
  }
  return [...byPlayer.values()];
}

/**
 * Exchange research card order: contract identity first, then unpaired model
 * estimates. Cycle evenly through fixtures so a 100-card cap does not
 * conceal an entire NBA matchup. This never changes quote eligibility.
 */
export function orderExchangeResearchCards(rows=[],limit=100) {
 const max=Number.isInteger(limit)?Math.max(0,Math.min(limit,2000)):100;
 const out=[],rank=r=>r.marketAvailable===true?0:
  r.contractId&&r.identityVerified===true&&r.provider?1:
  r.fbis_projection!=null?2:3;
 const cmp=(a,b)=>String(a.start_time||'').localeCompare(String(b.start_time||''))||
  String(a.player_name||'').localeCompare(String(b.player_name||''))||
  String(a.canonical_market||'').localeCompare(String(b.canonical_market||''))||
  String(a.contractId||'').localeCompare(String(b.contractId||''));
 for(let tier=0;tier<=3&&out.length<max;tier++){
  const buckets=new Map();
  for(const row of rows)if(rank(row)===tier){
   const key=String(row.canonicalEventId||row.start_time||'UNMATCHED');
   if(!buckets.has(key))buckets.set(key,[]);
   buckets.get(key).push(row);
  }
  let keys=[...buckets.keys()].sort((a,b)=>cmp(buckets.get(a)[0],buckets.get(b)[0]));
  for(const k of keys)buckets.get(k).sort(cmp);
  let index=0;
  while(keys.length&&out.length<max){
   const k=keys[index],bucket=buckets.get(k);
   out.push(bucket.shift());
   if(bucket.length)index=(index+1)%keys.length;
   else{keys.splice(index,1);if(keys.length)index%=keys.length;}
  }
 }
 return out;
}

/**
 * Pair source contracts by independent canonical identity: never player-name
 * similarity, price proximity, or approximate threshold. Only one distinct
 * Kalshi and Polymarket contract can occupy a card; extra contracts remain
 * individually visible. Comparable prices require identical verified rules.
 */
export function buildVenueComparisonRows(rows=[]) {
 const sideOf=r=>r.statSide==='over'||r.statSide==='under'?r.statSide:
  r.side==='over'||r.side==='under'?r.side:null;
 const money=x=>x!=null&&x!==''&&Number.isFinite(Number(x))&&Number(x)>0&&Number(x)<1?Number(x):null;
 const venue=r=>({
  provider:r.provider,contractId:r.contractId||null,side:r.side||null,
  price:money(r.purchaseAsk??r.observedAsk),priceKind:r.purchaseAsk!=null?'VERIFIED_PURCHASE_ASK':'OBSERVED_ASK',
  depth:r.executableSize??r.observedDepth??null,observedAt:r.observedAt||null,
  collectedAt:r.collectedAt||null,sourceTimeVerified:r.fresh===true&&r.priceVerified===true,
  marketAvailable:r.marketAvailable===true,settlementTerms:r.settlementTerms||null,
  dnpSettlement:r.dnpSettlement||null,
 });
 const keyOf=r=>r.identityVerified===true&&r.contractId&&
  ['Kalshi','Polymarket'].includes(r.provider)&&r.canonicalEventId&&r.canonicalPlayerId&&
  r.canonical_market&&r.period&&r.line!=null&&Number.isFinite(Number(r.line))&&Number(r.line)>=0&&sideOf(r)?
  [r.sport,r.canonicalEventId,r.canonicalPlayerId,r.canonical_market,r.period,
   Number(r.line).toString(),sideOf(r)].join('|'):null;
 const pools=new Map();
 rows.forEach((r,i)=>{const key=keyOf(r);if(!key)return;
  if(!pools.has(key))pools.set(key,[]);
  pools.get(key).push(i);
 });
 const used=new Set(),output=[];
 for(let i=0;i<rows.length;i++){
  if(used.has(i))continue;
  const base=rows[i],key=keyOf(base);let other=null,otherIndex=null;
  if(key){
   for(const j of pools.get(key)||[]){
    const candidate=rows[j];
    if(j!==i&&!used.has(j)&&candidate.provider!==base.provider){
     other=candidate;otherIndex=j;break;
    }
   }
  }
  used.add(i);if(otherIndex!=null)used.add(otherIndex);
  const pair=[base,...(other?[other]:[])].sort((a,b)=>
   (a.provider==='Kalshi'?0:1)-(b.provider==='Kalshi'?0:1));
  const offers=pair.map(venue);
  const exactRules=Boolean(other&&base.identityVerified===true&&other.identityVerified===true&&
   base.settlementTerms&&other.settlementTerms&&base.settlementTerms===other.settlementTerms&&
   base.settlementScope&&base.settlementScope===other.settlementScope&&
   base.dnpSettlement&&base.dnpSettlement===other.dnpSettlement&&
   sideOf(base)===sideOf(other));
  const pricingReady=exactRules&&offers.every(v=>v.price!=null&&v.marketAvailable&&
   v.sourceTimeVerified&&v.priceKind==='VERIFIED_PURCHASE_ASK');
  const kalshi=offers.find(v=>v.provider==='Kalshi'),poly=offers.find(v=>v.provider==='Polymarket');
  const gap=pricingReady?Number((poly.price-kalshi.price).toFixed(4)):null;
  const primary=pair.find(r=>r.fbis_projection!=null)||pair[0];
  output.push({...primary,id:other?'compare:'+key+':'+i:base.id,
   venueComparison:{venues:offers,providerCount:offers.length,
    contractIdentityMatched:other!=null,settlementEquivalent:exactRules,
    priceComparisonStatus:!other?'OTHER_PROVIDER_UNAVAILABLE':
     !exactRules?'SETTLEMENT_NOT_EQUIVALENT_OR_UNVERIFIED':
     !pricingReady?'QUOTE_CLOCK_OR_EXECUTION_UNVERIFIED':'COMPARABLE_CURRENT_QUOTES',
    priceDifferenceDollars:gap,
    cheaperProvider:gap==null||gap===0?null:gap>0?'Kalshi':'Polymarket',
    canAuthorizeWager:false}});
 }
 return output;
}
