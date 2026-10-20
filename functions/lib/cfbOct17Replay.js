/**
 * October 17, 2026 CFB projection replay — original frozen CLOSE vs repaired
 * current-season pipeline vs actuals. Never writes to prediction_snapshots.
 *
 * Modes:
 *   A. strict — only rows with demonstrated feature as_of < kickoff
 *   B. diagnostic — uses latest pre-kickoff (or as-of ≤ freeze) snapshots even
 *      when independent CFBD publication receipts are unavailable
 *
 * Aggregate accuracy claims must not mix the two modes.
 */

import { projectCfbFbisV2Production } from "./cfbFbisV2.js";
import { resolvePersistedGamesPlayed } from "./cfbDeepFeed.js";
import {
  projectModelA,
  projectModelB,
  projectModelC,
  projectModelD,
  projectModelE,
} from "./cfbCurrentSeasonChallengers.js";
import PRIOR_V1 from "../../data/cfb/prior-v1.js";

const NATIONAL = 26.5;

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function priorForEspn(espnId) {
  const row = PRIOR_V1?.byEspnId?.[String(espnId)];
  if (!row) return { priorOff: null, priorDef: null, school: null };
  return {
    priorOff: num(row.off),
    priorDef: num(row.def),
    school: row.school || null,
    source: "prior-v1",
  };
}

function parseMatchup(matchup = "") {
  const m = String(matchup).split("@").map((s) => s.trim());
  if (m.length !== 2) return { awayName: null, homeName: null };
  return { awayName: m[0], homeName: m[1] };
}

export function sideInputFromSnapshot(features = {}, prior = {}) {
  const gamesPlayed = resolvePersistedGamesPlayed(features) ?? 0;
  return {
    priorOff: prior.priorOff ?? num(features.priorOff),
    priorDef: prior.priorDef ?? num(features.priorDef),
    gamesPlayed,
    gamesPlayedSource: features.gamesPlayedSource || null,
    coreThroughWeek: num(features.coreThroughWeek),
    coreWeekBounded: features.coreWeekBounded === true || features.coreWeekBounded === "1",
    // Accept both canonical ppaOff and deep-feed offensePpa aliases.
    offensePpa: num(features.ppaOff ?? features.offensePpa),
    defensePpa: num(features.ppaDef ?? features.defensePpa),
    passEpa: num(features.ppaPass ?? features.passEpa),
    rushEpa: num(features.ppaRush ?? features.rushEpa),
    passEpaAllowed: num(features.ppaPassAllowed ?? features.passEpaAllowed),
    rushEpaAllowed: num(features.ppaRushAllowed ?? features.rushEpaAllowed),
    successRate: num(features.offensiveSuccessRate ?? features.successRate),
    successRateAllowed: num(features.defensiveSuccessRate ?? features.successRateAllowed),
    explosiveRate: num(features.offensiveExplosiveness ?? features.explosiveRate),
    explosiveRateAllowed: num(features.defensiveExplosiveness ?? features.explosiveRateAllowed),
    lineYards: num(features.offensiveLineYards ?? features.lineYards),
    lineYardsAllowed: num(features.defensiveLineYards ?? features.lineYardsAllowed),
    havocRate: num(features.defensiveHavoc ?? features.havocRate),
    havocAllowed: num(features.offensiveHavoc ?? features.havocAllowed),
    pointsPerOpportunity: num(features.offensivePointsPerOpportunity ?? features.pointsPerOpportunity),
    pointsPerOpportunityAllowed: num(
      features.defensivePointsPerOpportunity ?? features.pointsPerOpportunityAllowed
    ),
  };
}

export function classifyReplayEligibility({
  featureAsOf,
  kickoff,
  freezeAt,
  mode = "diagnostic",
} = {}) {
  const asOf = Date.parse(String(featureAsOf || ""));
  const kick = Date.parse(String(kickoff || ""));
  const freeze = Date.parse(String(freezeAt || ""));
  if (!Number.isFinite(asOf)) {
    return { eligible: false, reason: "feature-as-of-missing", mode };
  }
  if (Number.isFinite(kick) && asOf >= kick) {
    return { eligible: false, reason: "feature-after-kickoff", mode };
  }
  if (mode === "strict") {
    // Strict requires as_of before kickoff AND before the freeze used for the
    // original card. Independent provider publication receipts are still
    // required at the report layer before claiming unbiased OOS evidence.
    if (Number.isFinite(freeze) && asOf > freeze) {
      return { eligible: false, reason: "feature-after-freeze", mode };
    }
    return {
      eligible: true,
      reason: null,
      mode: "strict",
      caveat: "strict-availability-window-only; attach CFBD publication receipt before OOS claims",
    };
  }
  return {
    eligible: true,
    reason: null,
    mode: "diagnostic",
    caveat: "diagnostic-reconstruction; not valid unbiased predictive evidence",
  };
}

export function scoreErrors(projHome, projAway, actualHome, actualAway) {
  const ph = num(projHome);
  const pa = num(projAway);
  const ah = num(actualHome);
  const aa = num(actualAway);
  if ([ph, pa, ah, aa].some((v) => v == null)) {
    return { graded: false };
  }
  const projMargin = ph - pa;
  const actualMargin = ah - aa;
  const projTotal = ph + pa;
  const actualTotal = ah + aa;
  const projWinner = projMargin === 0 ? "push" : projMargin > 0 ? "home" : "away";
  const actualWinner = actualMargin === 0 ? "push" : actualMargin > 0 ? "home" : "away";
  return {
    graded: true,
    homeError: Math.abs(ph - ah),
    awayError: Math.abs(pa - aa),
    marginError: Math.abs(projMargin - actualMargin),
    totalError: Math.abs(projTotal - actualTotal),
    winnerCorrect: projWinner !== "push" && projWinner === actualWinner,
    projWinner,
    actualWinner,
    biasHome: ph - ah,
    biasAway: pa - aa,
    biasMargin: projMargin - actualMargin,
    biasTotal: projTotal - actualTotal,
  };
}

/**
 * Replay one CLOSE row given home/away feature JSON objects and ESPN ids.
 */
export function replayOneGame({
  close,
  homeEspnId,
  awayEspnId,
  homeFeatures,
  awayFeatures,
  homeFeatureAsOf,
  awayFeatureAsOf,
  kickoff,
  mode = "diagnostic",
  withCore = true,
} = {}) {
  const eligibility = classifyReplayEligibility({
    featureAsOf: homeFeatureAsOf && awayFeatureAsOf
      ? (String(homeFeatureAsOf) < String(awayFeatureAsOf) ? homeFeatureAsOf : awayFeatureAsOf)
      : homeFeatureAsOf || awayFeatureAsOf,
    kickoff: kickoff || close?.kickoff || close?.start,
    freezeAt: close?.frozen_at || close?.frozenAt,
    mode,
  });

  const homePrior = priorForEspn(homeEspnId);
  const awayPrior = priorForEspn(awayEspnId);
  const homeIn = sideInputFromSnapshot(homeFeatures || {}, homePrior);
  const awayIn = sideInputFromSnapshot(awayFeatures || {}, awayPrior);
  if (!withCore) {
    delete homeIn.coreThroughWeek;
    delete awayIn.coreThroughWeek;
    // Keep gamesPlayed from resolvePersistedGamesPlayed which may still use week.
  }

  const { awayName, homeName } = parseMatchup(close?.matchup);
  const game = {
    id: String(close?.game_id || close?.gameId || ""),
    sport: "cfb",
    start: kickoff || close?.kickoff || close?.start,
    home: { name: homeName || homePrior.school, school: homePrior.school, espnId: String(homeEspnId) },
    away: { name: awayName || awayPrior.school, school: awayPrior.school, espnId: String(awayEspnId) },
    cfbFbisV2Input: { home: homeIn, away: awayIn },
  };

  const rebuilt = projectCfbFbisV2Production(game);
  const modelA = projectModelA(game);
  const modelB = projectModelB(game);
  const modelC = projectModelC(game, { coreArtifact: null });
  const modelD = projectModelD(game);
  const modelE = projectModelE(game);
  const original = {
    home: num(close?.proj_home ?? close?.projHome),
    away: num(close?.proj_away ?? close?.projAway),
  };
  const actual = {
    home: num(close?.actual_home ?? close?.actualHome),
    away: num(close?.actual_away ?? close?.actualAway),
  };

  const originalErr = scoreErrors(original.home, original.away, actual.home, actual.away);
  const rebuiltErr = scoreErrors(rebuilt.home, rebuilt.away, actual.home, actual.away);
  const errB = scoreErrors(modelB.home, modelB.away, actual.home, actual.away);
  const errE = scoreErrors(modelE.home, modelE.away, actual.home, actual.away);

  return {
    gameId: game.id,
    matchup: close?.matchup || `${awayName} @ ${homeName}`,
    mode: eligibility.mode,
    eligible: eligibility.eligible,
    eligibilityReason: eligibility.reason,
    caveat: eligibility.caveat || null,
    original: {
      home: original.home,
      away: original.away,
      frozenAt: close?.frozen_at || close?.frozenAt || null,
    },
    rebuilt: {
      home: rebuilt.ok ? rebuilt.home : null,
      away: rebuilt.ok ? rebuilt.away : null,
      ok: rebuilt.ok,
      provisional: rebuilt.provisional,
      priorDecay: rebuilt.priorDecay,
      missingCurrentSignals: rebuilt.missingCurrentSignals || [],
      marginFeatures: rebuilt.marginFeatures,
    },
    challengers: {
      A: { home: modelA.home, away: modelA.away, ok: modelA.ok, error: rebuiltErr },
      B: {
        home: modelB.ok ? modelB.home : null,
        away: modelB.ok ? modelB.away : null,
        ok: modelB.ok,
        fittedArtifactId: modelB.fittedArtifactId || null,
        oosDecision: modelB.oosDecision || null,
        error: errB,
      },
      C: {
        ok: modelC.ok,
        reason: modelC.reason || null,
        note: "CORE incremental value unproven without fitted OOS artifact",
      },
      D: {
        ok: modelD.ok,
        reason: modelD.reason || null,
        note: modelD.note || "SDV challenger fails closed without fitted artifact",
      },
      E: {
        home: modelE.ok ? modelE.home : null,
        away: modelE.ok ? modelE.away : null,
        ok: modelE.ok,
        fittedArtifactId: modelE.fittedArtifactId || null,
        oosDecision: modelE.oosDecision || null,
        error: errE,
      },
    },
    actual,
    originalError: originalErr,
    rebuiltError: rebuiltErr,
    delta: {
      home: rebuilt.ok && original.home != null ? round1(rebuilt.home - original.home) : null,
      away: rebuilt.ok && original.away != null ? round1(rebuilt.away - original.away) : null,
    },
    winnerChange:
      originalErr.graded && rebuiltErr.graded
        ? {
            originalCorrect: originalErr.winnerCorrect,
            rebuiltCorrect: rebuiltErr.winnerCorrect,
            corrected: !originalErr.winnerCorrect && rebuiltErr.winnerCorrect,
            worsened: originalErr.winnerCorrect && !rebuiltErr.winnerCorrect,
          }
        : null,
    nationalPpg: NATIONAL,
    withCore,
  };
}

export function aggregateReplayMetrics(rows = []) {
  const graded = rows.filter((r) => r.eligible && r.originalError?.graded && r.rebuiltError?.graded && r.rebuilt?.ok);
  const agg = (key, side) => {
    const vals = graded.map((r) => r[key]?.[side]).filter((v) => v != null);
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  };
  const winnerOrig = graded.filter((r) => r.originalError.winnerCorrect).length;
  const winnerReb = graded.filter((r) => r.rebuiltError.winnerCorrect).length;
  const corrected = graded.filter((r) => r.winnerChange?.corrected).length;
  const worsened = graded.filter((r) => r.winnerChange?.worsened).length;
  const bias = (field) => {
    const vals = graded.map((r) => r.rebuiltError?.[field]).filter((v) => v != null);
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  };
  return {
    nEligibleGraded: graded.length,
    nInput: rows.length,
    nIneligible: rows.filter((r) => !r.eligible).length,
    original: {
      winnerPct: graded.length ? round1((100 * winnerOrig) / graded.length) : null,
      marginMae: agg("originalError", "marginError"),
      totalMae: agg("originalError", "totalError"),
      homeMae: agg("originalError", "homeError"),
      awayMae: agg("originalError", "awayError"),
    },
    rebuilt: {
      winnerPct: graded.length ? round1((100 * winnerReb) / graded.length) : null,
      marginMae: agg("rebuiltError", "marginError"),
      totalMae: agg("rebuiltError", "totalError"),
      homeMae: agg("rebuiltError", "homeError"),
      awayMae: agg("rebuiltError", "awayError"),
      biasHome: bias("biasHome"),
      biasAway: bias("biasAway"),
      biasMargin: bias("biasMargin"),
      biasTotal: bias("biasTotal"),
    },
    winnerSelections: { corrected, worsened, net: corrected - worsened },
    largestHomeChanges: graded
      .map((r) => ({ gameId: r.gameId, matchup: r.matchup, deltaHome: r.delta?.home, deltaAway: r.delta?.away }))
      .filter((r) => r.deltaHome != null)
      .sort((a, b) => Math.abs(b.deltaHome) - Math.abs(a.deltaHome))
      .slice(0, 10),
    note: "Projection accuracy only. No ATS/ROI without captured market prices.",
  };
}
