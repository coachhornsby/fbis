/**
 * Reproducible Oklahoma @ Kentucky (2026-10-17) projection audit.
 * Reconstructs the original 34.1 home projection from 2025 priors with
 * gamesPlayed=0, and the repaired projection using persisted 2026 PPA +
 * week-bounded gamesPlayed. Does not overwrite frozen prediction_snapshots.
 */

import { projectCfbFbisV2, projectCfbFbisV2Production } from "./cfbFbisV2.js";
import { blendWithAudit, currentSeasonDominates } from "./cfbPriorDecay.js";

export const OKLAHOMA_AUDIT_GAME_ID = "401856722";
export const OKLAHOMA_ESPN_ID = "201";
export const OKLAHOMA_STATE_ESPN_ID = "197";
export const KENTUCKY_ESPN_ID = "96";

/** Frozen CLOSE snapshot values (immutable production record). */
export const OKLAHOMA_ORIGINAL_CLOSE = Object.freeze({
  gameId: OKLAHOMA_AUDIT_GAME_ID,
  matchup: "Kentucky @ Oklahoma",
  frozenAt: "2026-10-17T22:53:25.284Z",
  kickoff: "2026-10-17T23:30:00.000Z",
  projHome: 34.1,
  projAway: 15.2,
  projMargin: 18.9,
  projTotal: 49.3,
  actualHome: 13,
  actualAway: 21,
  projectionState: "PROVISIONAL",
});

/** 2025 prior-v1 SRS+FPI ratings used as early-season prior. */
export const OKLAHOMA_2025_PRIOR = Object.freeze({
  espnId: OKLAHOMA_ESPN_ID,
  school: "Oklahoma",
  priorOff: 34.61,
  priorDef: 13.51,
  source: "data/cfb/prior-v1.js (srs+fpi)",
  season: 2025,
});

export const KENTUCKY_2025_PRIOR = Object.freeze({
  espnId: KENTUCKY_ESPN_ID,
  school: "Kentucky",
  priorOff: 28.58,
  priorDef: 22.66,
  source: "data/cfb/prior-v1.js (srs+fpi)",
  season: 2025,
});

/**
 * Persisted D1 team_feature_snapshots for Oklahoma (cfb-201) as of 2026-10-17
 * before kickoff. Units: PPA per play (not CORE per 100, not PPG).
 */
export const OKLAHOMA_2026_PREGAME_FEATURES = Object.freeze({
  teamId: "cfb-201",
  asOf: "2026-10-17T16:32:42.994Z",
  ppaOff: -0.04,
  ppaDef: -0.16,
  ppaPass: 0.27,
  ppaRush: -0.24,
  ppaPassAllowed: -0.07,
  ppaRushAllowed: -0.08,
  offensiveSuccessRate: 0.3821656050955414,
  defensiveSuccessRate: 0.3150684931506849,
  coreThroughWeek: 6,
  coreWeekBounded: true,
  // SP composite in the snapshot — NOT current PPG. Never feed as `off` current.
  spOff: 25.6,
  spDef: 13.6,
});

export const KENTUCKY_2026_PREGAME_FEATURES = Object.freeze({
  teamId: "cfb-96",
  asOf: "2026-10-17T16:32:44.243Z",
  ppaOff: 0.21,
  ppaDef: 0.04,
  ppaPass: 0.24,
  ppaRush: 0.19,
  ppaPassAllowed: 0.11,
  ppaRushAllowed: 0.06,
  offensiveSuccessRate: 0.495,
  defensiveSuccessRate: 0.44419134396355353,
  coreThroughWeek: 6,
  coreWeekBounded: true,
  spOff: 33.1,
  spDef: 25,
});

const NATIONAL_PPG = 26.5;
const PPA_TO_POINTS = 40;

export function ppaToPoints(ppa, national = NATIONAL_PPG) {
  const v = Number(ppa);
  if (!Number.isFinite(v)) return null;
  return national + v * PPA_TO_POINTS;
}

function sideFromPriorOnly(prior) {
  return {
    priorOff: prior.priorOff,
    priorDef: prior.priorDef,
    gamesPlayed: 0,
  };
}

function sideFromRepaired(prior, feat) {
  return {
    priorOff: prior.priorOff,
    priorDef: prior.priorDef,
    gamesPlayed: feat.coreThroughWeek,
    coreThroughWeek: feat.coreThroughWeek,
    coreWeekBounded: feat.coreWeekBounded === true,
    offensePpa: feat.ppaOff,
    defensePpa: feat.ppaDef,
    passEpa: feat.ppaPass,
    rushEpa: feat.ppaRush,
    passEpaAllowed: feat.ppaPassAllowed,
    rushEpaAllowed: feat.ppaRushAllowed,
    successRate: feat.offensiveSuccessRate,
    successRateAllowed: feat.defensiveSuccessRate,
  };
}

function gameEnvelope(homeInput, awayInput) {
  return {
    id: OKLAHOMA_AUDIT_GAME_ID,
    sport: "cfb",
    start: OKLAHOMA_ORIGINAL_CLOSE.kickoff,
    home: { name: "Oklahoma", school: "Oklahoma", espnId: OKLAHOMA_ESPN_ID },
    away: { name: "Kentucky", school: "Kentucky", espnId: KENTUCKY_ESPN_ID },
    cfbFbisV2Input: { home: homeInput, away: awayInput },
  };
}

/**
 * Full numerical reconstruction of the original 34.1 and the repaired forecast.
 */
export function runOklahomaProjectionAudit({
  ouFeatures = OKLAHOMA_2026_PREGAME_FEATURES,
  ukFeatures = KENTUCKY_2026_PREGAME_FEATURES,
} = {}) {
  const originalGame = gameEnvelope(
    sideFromPriorOnly(OKLAHOMA_2025_PRIOR),
    sideFromPriorOnly(KENTUCKY_2025_PRIOR)
  );
  const originalRaw = projectCfbFbisV2(originalGame);
  const originalFitted = projectCfbFbisV2Production(originalGame);

  const repairedGame = gameEnvelope(
    sideFromRepaired(OKLAHOMA_2025_PRIOR, ouFeatures),
    sideFromRepaired(KENTUCKY_2025_PRIOR, ukFeatures)
  );
  const repairedRaw = projectCfbFbisV2(repairedGame);
  const repairedFitted = projectCfbFbisV2Production(repairedGame);

  const ouCurrentOff = ppaToPoints(ouFeatures.ppaOff);
  const ouBlend = blendWithAudit(OKLAHOMA_2025_PRIOR.priorOff, ouCurrentOff, ouFeatures.coreThroughWeek);
  const week7 = currentSeasonDominates({ gamesPlayed: ouFeatures.coreThroughWeek });

  const originalWithinTolerance =
    Math.abs(originalFitted.home - OKLAHOMA_ORIGINAL_CLOSE.projHome) < 0.05 &&
    Math.abs(originalFitted.away - OKLAHOMA_ORIGINAL_CLOSE.projAway) < 0.05;

  return {
    gameId: OKLAHOMA_AUDIT_GAME_ID,
    identityCheck: {
      oklahomaEspnId: OKLAHOMA_ESPN_ID,
      oklahomaStateEspnId: OKLAHOMA_STATE_ESPN_ID,
      crossContamination: OKLAHOMA_ESPN_ID === OKLAHOMA_STATE_ESPN_ID ? "FAIL" : "PASS",
    },
    originalClose: OKLAHOMA_ORIGINAL_CLOSE,
    rootCause: {
      summary:
        "Deep-feed PPA existed in team_feature_snapshots before kickoff, but gamesPlayed resolved to 0, so blendPriorCurrent assigned 100% weight to the 2025 priorOff 34.61. Fitted M*=A ridge then produced 34.1–15.2.",
      omittedInputs: [
        "offensePpa / defensePpa present in D1 but unused because gamesPlayed=0",
        "coreThroughWeek=6 available but not mapped into gamesPlayed by readPersistedCfbDeep",
        "home_no_current_ppg / home_epa_missing flags reflected team_form / estimateTeam gaps, not absence of PPA in D1",
      ],
      priorOff: OKLAHOMA_2025_PRIOR.priorOff,
      priorDef: OKLAHOMA_2025_PRIOR.priorDef,
      nationalPpg: NATIONAL_PPG,
      ppaToPointsScale: PPA_TO_POINTS,
      hfa: 2.5,
      basePowerManual: {
        homeOff: OKLAHOMA_2025_PRIOR.priorOff,
        homeDef: OKLAHOMA_2025_PRIOR.priorDef,
        awayOff: KENTUCKY_2025_PRIOR.priorOff,
        awayDef: KENTUCKY_2025_PRIOR.priorDef,
        baseHome: OKLAHOMA_2025_PRIOR.priorOff + (KENTUCKY_2025_PRIOR.priorDef - NATIONAL_PPG),
        baseAway: KENTUCKY_2025_PRIOR.priorOff + (OKLAHOMA_2025_PRIOR.priorDef - NATIONAL_PPG),
        baseMargin: originalRaw.decomposition?.BASE_POWER,
        baseTotal: originalRaw.decomposition?.BASE_TOTAL,
      },
      fitted: {
        Mstar: "A",
        Tstar: "A",
        marginIntercept: 5.881256656017041,
        marginBeta: 12.521909937077329,
        totalIntercept: 53.13099041533531,
        totalBeta: 3.0803449207393965,
      },
    },
    originalReconstruction: {
      withinRoundingTolerance: originalWithinTolerance,
      raw: { home: originalRaw.home, away: originalRaw.away, margin: originalRaw.margin, total: originalRaw.total },
      fitted: {
        home: originalFitted.home,
        away: originalFitted.away,
        margin: originalFitted.margin,
        total: originalFitted.total,
        marginFeatures: originalFitted.marginFeatures,
        totalFeatures: originalFitted.totalFeatures,
      },
      priorShare: originalFitted.uncertainty?.prior_share,
      gamesPlayedHome: 0,
      gamesPlayedAway: 0,
    },
    repaired: {
      ouCurrentOffPpaPoints: ouCurrentOff,
      ouOffBlend: ouBlend,
      week7CurrentDominates: week7,
      raw: { home: repairedRaw.home, away: repairedRaw.away, margin: repairedRaw.margin, total: repairedRaw.total },
      fitted: {
        home: repairedFitted.home,
        away: repairedFitted.away,
        margin: repairedFitted.margin,
        total: repairedFitted.total,
        marginFeatures: repairedFitted.marginFeatures,
        totalFeatures: repairedFitted.totalFeatures,
        provisional: repairedFitted.provisional,
        priorDecay: repairedFitted.priorDecay,
        missingCurrentSignals: repairedFitted.missingCurrentSignals,
      },
      vsActual: {
        actualHome: OKLAHOMA_ORIGINAL_CLOSE.actualHome,
        actualAway: OKLAHOMA_ORIGINAL_CLOSE.actualAway,
        originalHomeError: Math.abs(OKLAHOMA_ORIGINAL_CLOSE.projHome - OKLAHOMA_ORIGINAL_CLOSE.actualHome),
        originalAwayError: Math.abs(OKLAHOMA_ORIGINAL_CLOSE.projAway - OKLAHOMA_ORIGINAL_CLOSE.actualAway),
        repairedHomeError: Math.abs(repairedFitted.home - OKLAHOMA_ORIGINAL_CLOSE.actualHome),
        repairedAwayError: Math.abs(repairedFitted.away - OKLAHOMA_ORIGINAL_CLOSE.actualAway),
        originalMarginError: Math.abs(OKLAHOMA_ORIGINAL_CLOSE.projMargin - (OKLAHOMA_ORIGINAL_CLOSE.actualHome - OKLAHOMA_ORIGINAL_CLOSE.actualAway)),
        repairedMarginError: Math.abs(repairedFitted.margin - (OKLAHOMA_ORIGINAL_CLOSE.actualHome - OKLAHOMA_ORIGINAL_CLOSE.actualAway)),
      },
    },
    remainingInflation30p4: explainRepairedOklahomaInflation({
      ouFeatures,
      ukFeatures,
      ouBlend,
      repairedFitted,
    }),
    mode: "diagnostic-reconstruction",
    note: "Feature as_of is before kickoff in D1; treat as diagnostic unless an independent CFBD publication receipt is attached for strict historical replay.",
  };
}

/**
 * Why repaired OU still projects ~30.4 despite poor current-season offense ranks.
 * Does not invent a scoring cap — documents each mathematical contribution.
 */
export function explainRepairedOklahomaInflation({
  ouFeatures = OKLAHOMA_2026_PREGAME_FEATURES,
  ukFeatures = KENTUCKY_2026_PREGAME_FEATURES,
  ouBlend = null,
  repairedFitted = null,
} = {}) {
  const ouCurrentOff = ppaToPoints(ouFeatures.ppaOff);
  const ouCurrentDef = ppaToPoints(ouFeatures.ppaDef);
  const ukCurrentOff = ppaToPoints(ukFeatures.ppaOff);
  const ukCurrentDef = ppaToPoints(ukFeatures.ppaDef);
  const n = ouFeatures.coreThroughWeek;
  const w = n / (n + 6);
  const blendOff = (1 - w) * OKLAHOMA_2025_PRIOR.priorOff + w * ouCurrentOff;
  const currentOnlyGame = gameEnvelope(
    {
      priorOff: ouCurrentOff,
      priorDef: ouCurrentDef,
      gamesPlayed: 99,
      offensePpa: ouFeatures.ppaOff,
      defensePpa: ouFeatures.ppaDef,
    },
    {
      priorOff: ukCurrentOff,
      priorDef: ukCurrentDef,
      gamesPlayed: 99,
      offensePpa: ukFeatures.ppaOff,
      defensePpa: ukFeatures.ppaDef,
    }
  );
  const currentOnly = projectCfbFbisV2Production(currentOnlyGame);
  return {
    repairedHome: repairedFitted?.home ?? 30.4,
    actualHome: 13,
    residualError: Math.abs((repairedFitted?.home ?? 30.4) - 13),
    factors: [
      {
        id: "prior-still-50pct",
        evidence: `At n=${n}, k=6 → currentWeight=${w}. Blended OU offense = (1-${w})*${OKLAHOMA_2025_PRIOR.priorOff} + ${w}*${ouCurrentOff} ≈ ${blendOff.toFixed(2)}`,
        classification: "model-calibration / prior-decay",
      },
      {
        id: "champion-ignores-advanced-offense-limits",
        evidence:
          "Fitted M*=A/T*=A consumes only overall PPA base. Success rate, rush PPA, explosiveness, line yards, PPO, and third-down style limits are collected but have zero champion coefficient.",
        classification: "model-calibration (deliberate unused features)",
      },
      {
        id: "opponent-adjustment-limited-to-ppa",
        evidence: `UK defense PPA ${ukFeatures.ppaDef} → ${ukCurrentDef} pts; OU offense still blended near ${blendOff.toFixed(1)} before UK defense adjustment.`,
        classification: "model-calibration",
      },
      {
        id: "fitted-intercept-lifts-home",
        evidence:
          "Margin ridge intercept ≈ +5.88 on standardized base; even a modest base margin is lifted toward larger home favorites.",
        classification: "model-calibration",
      },
      {
        id: "coreThroughWeek-as-n-proxy",
        evidence:
          "Observation count used coreThroughWeek=6 (flagged fallback). True completed-game count may differ; uncertainty must be shown.",
        classification: "pipeline",
      },
    ],
    currentOnlyProjection: {
      home: currentOnly.home,
      away: currentOnly.away,
      note: "Diagnostic: force n→large so prior weight≈0 using same PPA and fitted A/A",
    },
    systematicHypothesis:
      "Inefficient offenses remain inflated when 2025 priors are strong and advanced negative indicators never enter fitted A/A. Defense-oriented teams are not fully credited beyond overall PPA allowed.",
    doNot: "Do not impose an arbitrary OU scoring cap or hand-tune coefficients from this single game.",
  };
}
