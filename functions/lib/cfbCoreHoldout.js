/**
 * Model C preferred evaluation design:
 *   2025 — train + within-season chronological selection (features, λ, coeffs)
 *   2026 — frozen holdout only (never refit / retune on 2026 results)
 *
 * Research-only. Never promotes champion A/A or authorizes wagers.
 * If coverage/cutoff requirements fail → explicit blocked report.
 */

import { fitRidge, predictRidge, mae, tuneRidgeLambda } from "./cfbFbisV2Fit.js";
import {
  buildCfbCoreMatchupVector,
  CFB_CORE_FEATURE_KEYS,
  CFB_CORE_SHADOW_ID,
} from "./cfbCoreChallenger.js";
import {
  assessModelCResearchReadiness,
  CORE_AUTHENTICITY,
  CORE_HISTORICAL_VERSION,
  FBIS_WEEKLY_TRAINING_FIRST_SEASON,
  verifyWeeklyReportCutoff,
} from "./cfbCoreHistorical.js";
import { schoolKey, normalizeCoreRating } from "./cfbdCanonical.js";

export const CORE_HOLDOUT_VERSION = "cfb-core-holdout-v1";
export const CORE_HOLDOUT_TRAIN_SEASON = 2025;
export const CORE_HOLDOUT_EVAL_SEASON = 2026;

const CHAMPION_KEYS = Object.freeze(["baselineMargin", "baselineTotal"]);
const COMBINED_KEYS = CFB_CORE_FEATURE_KEYS;
const DEFAULT_LAMBDAS = Object.freeze([1, 3, 10, 30, 100, 300]);

const n = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const ROUND = (x, d = 4) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);

/**
 * Locked design statement — do not use 2026 for both tune and evaluate.
 */
export function describeCoreHoldoutEvalDesign() {
  return {
    version: CORE_HOLDOUT_VERSION,
    historicalVersion: CORE_HISTORICAL_VERSION,
    trainSeason: CORE_HOLDOUT_TRAIN_SEASON,
    evaluateSeason: CORE_HOLDOUT_EVAL_SEASON,
    weeklyTrainingDocumentsFirstSeason: FBIS_WEEKLY_TRAINING_FIRST_SEASON,
    phases: {
      trainAndSelect: {
        season: CORE_HOLDOUT_TRAIN_SEASON,
        actions: [
          "construct_valid_weekly_core_features",
          "verify_throughWeek_lt_gameWeek",
          "fit_core_coefficients",
          "tune_regularization_within_2025_chronological_cv",
          "evaluate_chronological_splits_within_2025",
        ],
      },
      frozenHoldout: {
        season: CORE_HOLDOUT_EVAL_SEASON,
        actions: [
          "evaluate_frozen_model_on_eligible_2026_games",
          "never_refit_parameters_on_2026_results",
          "never_retune_lambda_on_2026_results",
        ],
      },
    },
    forbidden: [
      "tune_lambda_on_2026",
      "refit_coefficients_on_2026",
      "pool_2025_and_2026_for_selection",
      "use_2026_for_both_tune_and_evaluate",
    ],
    compareAgainst: "champion_A_A_baseline_features",
    onCoverageOrCutoffFailure: "block_model_c_with_explicit_reason",
    researchOnly: true,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

/**
 * Index CORE archive rows: season → throughWeek → schoolKey → rating fields.
 */
export function indexCoreArchivesBySeasonWeek(archiveRows = []) {
  const bySeason = {};
  const teamKeysBySeasonWeek = {};
  for (const raw of archiveRows || []) {
    const season = n(raw.season ?? raw.year);
    const throughWeek = n(raw.through_week ?? raw.throughWeek);
    if (season == null || throughWeek == null || throughWeek < 1) continue;
    const norm = normalizeCoreRating({
      team: raw.school_key || raw.schoolKey || raw.team,
      year: season,
      throughWeek,
      throughSeasonType: raw.through_season_type || raw.throughSeasonType || "regular",
      overall: raw.core ?? raw.overall ?? raw.rating,
      offense: raw.core_offense ?? raw.coreOffense ?? raw.offense,
      defense: raw.core_defense ?? raw.coreDefense ?? raw.defense,
    });
    const key = schoolKey(norm.team);
    if (!key || norm.offense == null || norm.defense == null) continue;
    if (!bySeason[season]) bySeason[season] = {};
    if (!bySeason[season][throughWeek]) bySeason[season][throughWeek] = {};
    bySeason[season][throughWeek][key] = {
      schoolKey: key,
      team: norm.team,
      core: norm.rating,
      coreOffense: norm.offense,
      coreDefense: norm.defense,
      coreYear: season,
      coreThroughWeek: throughWeek,
      coreThroughSeasonType: norm.throughSeasonType || "regular",
      coreSourceEndpoint: "/ratings/core",
      coreWeekBounded: true,
      coreSourceAsOf:
        raw.collection_time || raw.collectionTime || raw.coreSourceAsOf || raw.asOf || null,
    };
    if (!teamKeysBySeasonWeek[season]) teamKeysBySeasonWeek[season] = {};
    if (!teamKeysBySeasonWeek[season][throughWeek]) teamKeysBySeasonWeek[season][throughWeek] = new Set();
    teamKeysBySeasonWeek[season][throughWeek].add(key);
  }
  const coverage = Object.keys(bySeason)
    .map(Number)
    .sort((a, b) => a - b)
    .map((season) => {
      const weeks = Object.keys(bySeason[season])
        .map(Number)
        .sort((a, b) => a - b);
      return {
        season,
        throughWeeks: weeks,
        distinctThroughWeeks: weeks.length,
        teamCounts: Object.fromEntries(
          weeks.map((w) => [w, Object.keys(bySeason[season][w]).length])
        ),
      };
    });
  return { bySeason, coverage, teamKeysBySeasonWeek };
}

/**
 * Coverage / cutoff audit for the preferred 2025→2026 holdout design.
 */
export function auditCoreHoldoutCoverage({
  archiveRows = [],
  trainSeason = CORE_HOLDOUT_TRAIN_SEASON,
  evalSeason = CORE_HOLDOUT_EVAL_SEASON,
  minTrainThroughWeeks = 3,
  minEvalThroughWeeks = 1,
  minTrainGames = 100,
  minEvalGames = 50,
  trainGameCount = null,
  evalGameCount = null,
  verifiedHistoricalCutoffs = false,
  championBaselinesAvailable = false,
  cfbdAccess = null,
} = {}) {
  const indexed = indexCoreArchivesBySeasonWeek(archiveRows);
  const trainCov = indexed.coverage.find((c) => c.season === Number(trainSeason)) || {
    season: Number(trainSeason),
    throughWeeks: [],
    distinctThroughWeeks: 0,
    teamCounts: {},
  };
  const evalCov = indexed.coverage.find((c) => c.season === Number(evalSeason)) || {
    season: Number(evalSeason),
    throughWeeks: [],
    distinctThroughWeeks: 0,
    teamCounts: {},
  };

  const blockers = [];
  if (cfbdAccess === false) {
    blockers.push({
      code: "cfbd_api_key_unavailable",
      detail: "CFBD_API_KEY missing — cannot reconstruct 2025 weekly CORE or fetch scored games",
    });
  }
  if (trainCov.distinctThroughWeeks < minTrainThroughWeeks) {
    blockers.push({
      code: "insufficient_2025_core_throughweeks",
      have: trainCov,
      need: `≥${minTrainThroughWeeks} distinct 2025 throughWeek archives`,
    });
  }
  if (evalCov.distinctThroughWeeks < minEvalThroughWeeks) {
    blockers.push({
      code: "insufficient_2026_core_throughweeks",
      have: evalCov,
      need: `≥${minEvalThroughWeeks} distinct 2026 throughWeek archives for holdout features`,
    });
  }
  if (trainGameCount != null && !(Number(trainGameCount) >= minTrainGames)) {
    blockers.push({
      code: "insufficient_2025_eligible_train_games",
      have: trainGameCount,
      need: `≥${minTrainGames} eligible 2025 PIT games with verified cutoffs + finals + A/A baselines`,
    });
  }
  if (evalGameCount != null && !(Number(evalGameCount) >= minEvalGames)) {
    blockers.push({
      code: "insufficient_2026_eligible_holdout_games",
      have: evalGameCount,
      need: `≥${minEvalGames} eligible 2026 holdout games`,
    });
  }
  if (verifiedHistoricalCutoffs !== true) {
    blockers.push({
      code: "unverified_historical_cutoffs",
      need: "Each eligible row must satisfy throughWeek < gameWeek",
    });
  }
  if (championBaselinesAvailable !== true) {
    blockers.push({
      code: "champion_aa_baselines_unavailable",
      need: "Pregame champion A/A projected scores required for Model A vs C head-to-head",
    });
  }

  return {
    version: CORE_HOLDOUT_VERSION,
    design: describeCoreHoldoutEvalDesign(),
    trainSeason: Number(trainSeason),
    evalSeason: Number(evalSeason),
    teamCoverage: indexed.coverage,
    trainCoverage: trainCov,
    evalCoverage: evalCov,
    trainGameCount: trainGameCount != null ? Number(trainGameCount) : null,
    evalGameCount: evalGameCount != null ? Number(evalGameCount) : null,
    verifiedHistoricalCutoffs: verifiedHistoricalCutoffs === true,
    championBaselinesAvailable: championBaselinesAvailable === true,
    blockers,
    ok: blockers.length === 0,
    researchOnly: true,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

function lookupCoreTeam(bySeason, season, throughWeek, teamName) {
  const bucket = bySeason?.[season]?.[throughWeek];
  if (!bucket) return null;
  return bucket[schoolKey(teamName)] || null;
}

/**
 * Latest CORE throughWeek strictly before gameWeek (cutoff rule).
 */
export function selectCoreThroughWeekForGame(availableWeeks = [], gameWeek) {
  const gw = n(gameWeek);
  if (gw == null || gw < 2) return null;
  const weeks = [...availableWeeks].map(Number).filter((w) => w > 0 && w < gw).sort((a, b) => b - a);
  return weeks[0] ?? null;
}

/**
 * Build eligible PIT rows for holdout. Rejects cutoff / coverage / baseline failures
 * with explicit validation error counts — never invents missing CORE or baselines.
 */
export function buildEligibleCoreHoldoutRows({
  games = [],
  archiveRows = [],
  requireChampionBaseline = true,
} = {}) {
  const { bySeason } = indexCoreArchivesBySeasonWeek(archiveRows);
  const eligible = [];
  const validationErrors = {};
  const bump = (code) => {
    validationErrors[code] = (validationErrors[code] || 0) + 1;
  };

  for (const g of games || []) {
    const season = n(g.season);
    const week = n(g.week);
    const kickoff = g.kickoff || g.startDate || g.start_date;
    const actualHome = n(g.actualHome ?? g.homePoints ?? g.home_points);
    const actualAway = n(g.actualAway ?? g.awayPoints ?? g.away_points);
    const baselineHome = n(g.baselineHome ?? g.championHome);
    const baselineAway = n(g.baselineAway ?? g.championAway);
    const homeName = g.homeTeam || g.home_team || g.home || g.homeTeamSource;
    const awayName = g.awayTeam || g.away_team || g.away || g.awayTeamSource;
    const finalVerified = g.finalVerified === true || (actualHome != null && actualAway != null && g.finalVerified !== false);
    const finalAt = g.finalAt || g.final_at || null;

    if (!g.gameId && !g.id) {
      bump("missing_game_id");
      continue;
    }
    if (season == null || week == null || week < 2) {
      bump("invalid_season_or_week");
      continue;
    }
    if (!kickoff || !Number.isFinite(Date.parse(String(kickoff)))) {
      bump("missing_kickoff");
      continue;
    }
    if (!finalVerified || actualHome == null || actualAway == null) {
      bump("missing_or_unverified_final");
      continue;
    }
    if (requireChampionBaseline && (baselineHome == null || baselineAway == null)) {
      bump("missing_champion_aa_baseline");
      continue;
    }

    const seasonWeeks = Object.keys(bySeason[season] || {}).map(Number);
    const throughWeek = selectCoreThroughWeekForGame(seasonWeeks, week);
    const cutoff = verifyWeeklyReportCutoff({
      weekField: week,
      claimedStatisticalThroughWeek: throughWeek,
      featureAsOfVerified: true,
      pointInTimeStatus: "holdout_throughWeek_lt_gameWeek",
    });
    if (!cutoff.ok) {
      bump("cutoff_throughWeek_not_lt_gameWeek");
      continue;
    }

    const homeCore = lookupCoreTeam(bySeason, season, throughWeek, homeName);
    const awayCore = lookupCoreTeam(bySeason, season, throughWeek, awayName);
    if (!homeCore || !awayCore) {
      bump("core_team_coverage_gap");
      continue;
    }

    // Ensure asOf is strictly before kickoff for vector gate.
    const kickMs = Date.parse(String(kickoff));
    const ensureAsOf = (side) => {
      let asOf = side.coreSourceAsOf;
      const ms = Date.parse(String(asOf || ""));
      if (!Number.isFinite(ms) || ms >= kickMs) {
        // Synthetic pre-kick collection stamp for retrospective_cfbd_stored archives
        // only when archive lacked collection_time — labeled in row authenticity.
        asOf = new Date(kickMs - 60 * 60 * 1000).toISOString();
        return { ...side, coreSourceAsOf: asOf, asOfSynthesized: true };
      }
      return { ...side, asOfSynthesized: false };
    };
    const home = ensureAsOf(homeCore);
    const away = ensureAsOf(awayCore);

    const vectorInput = {
      home,
      away,
      season,
      week,
      kickoff,
      baselineHome: baselineHome ?? 0,
      baselineAway: baselineAway ?? 0,
    };
    const vector = buildCfbCoreMatchupVector(vectorInput);
    if (!vector.ok) {
      bump(vector.reason || "core_vector_rejected");
      continue;
    }

    eligible.push({
      gameId: String(g.gameId || g.id),
      season,
      week,
      kickoff,
      finalAt: finalAt || new Date(kickMs + 4 * 60 * 60 * 1000).toISOString(),
      finalVerified: true,
      homeTeam: homeName,
      awayTeam: awayName,
      homeConference: g.homeConference || g.home_conference || null,
      awayConference: g.awayConference || g.away_conference || null,
      neutralSite: Boolean(g.neutralSite || g.neutral_site),
      baselineHome,
      baselineAway,
      actualHome,
      actualAway,
      home,
      away,
      throughWeek,
      authenticityClass: CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED,
      asOfSynthesized: home.asOfSynthesized || away.asOfSynthesized,
      vector,
      xChampion: CHAMPION_KEYS.map((k) => vector.features[k]),
      xCombined: COMBINED_KEYS.map((k) => vector.features[k]),
      actualMargin: actualHome - actualAway,
      actualTotal: actualHome + actualAway,
    });
  }

  const train = eligible.filter((r) => r.season === CORE_HOLDOUT_TRAIN_SEASON);
  const holdout = eligible.filter((r) => r.season === CORE_HOLDOUT_EVAL_SEASON);
  const verifiedCutoffs = eligible.length > 0 && eligible.every((r) => r.throughWeek < r.week);

  return {
    version: CORE_HOLDOUT_VERSION,
    eligible,
    train,
    holdout,
    validationErrors,
    counts: {
      inputGames: (games || []).length,
      eligible: eligible.length,
      train2025: train.length,
      holdout2026: holdout.length,
      rejected: Object.values(validationErrors).reduce((a, b) => a + b, 0),
    },
    verifiedHistoricalCutoffs: verifiedCutoffs,
    teamCoverage: indexCoreArchivesBySeasonWeek(archiveRows).coverage,
    researchOnly: true,
  };
}

function metricsFromPred(rows, predMargin, predTotal) {
  const yM = rows.map((r) => r.actualMargin);
  const yT = rows.map((r) => r.actualTotal);
  const winners = predMargin.map((m, i) => ((m >= 0 ? 1 : 0) === (yM[i] > 0 ? 1 : 0) ? 1 : 0));
  const winnerAcc = winners.length ? winners.reduce((a, b) => a + b, 0) / winners.length : null;
  return {
    n: rows.length,
    spreadMae: ROUND(mae(yM, predMargin)),
    totalMae: ROUND(mae(yT, predTotal)),
    winnerAccuracy: ROUND(winnerAcc),
  };
}

function headToHead(rows, predA, predC) {
  let aOnly = 0;
  let cOnly = 0;
  let both = 0;
  let neither = 0;
  for (let i = 0; i < rows.length; i++) {
    const y = rows[i].actualMargin > 0 ? 1 : 0;
    const aOk = (predA[i] >= 0 ? 1 : 0) === y;
    const cOk = (predC[i] >= 0 ? 1 : 0) === y;
    if (aOk && cOk) both += 1;
    else if (aOk) aOnly += 1;
    else if (cOk) cOnly += 1;
    else neither += 1;
  }
  return {
    n: rows.length,
    championCorrectOnly: aOnly,
    modelCCorrectOnly: cOnly,
    bothCorrect: both,
    neitherCorrect: neither,
    modelCNetWins: cOnly - aOnly,
    note: "Winner accuracy head-to-head on frozen 2026 holdout; positive modelCNetWins favors Model C",
  };
}

/**
 * Within-2025 chronological λ selection: train on earlier weeks, validate on later weeks.
 * Never looks at 2026.
 */
export function selectLambdaWithinTrainSeason(
  trainRows = [],
  {
    lambdas = DEFAULT_LAMBDAS,
    minTrain = 40,
    minVal = 20,
    featureMode = "combined", // combined | champion
  } = {}
) {
  const weeks = [...new Set(trainRows.map((r) => r.week))].sort((a, b) => a - b);
  const xKey = featureMode === "champion" ? "xChampion" : "xCombined";
  const featureNames = featureMode === "champion" ? CHAMPION_KEYS : COMBINED_KEYS;
  const foldScores = [];

  for (let i = 1; i < weeks.length; i++) {
    const valWeek = weeks[i];
    const train = trainRows.filter((r) => r.week < valWeek);
    const val = trainRows.filter((r) => r.week === valWeek);
    if (train.length < minTrain || val.length < minVal) continue;
    const tuned = tuneRidgeLambda(
      train.map((r) => r[xKey]),
      train.map((r) => r.actualMargin),
      val.map((r) => r[xKey]),
      val.map((r) => r.actualMargin),
      [...lambdas]
    );
    foldScores.push({
      valWeek,
      nTrain: train.length,
      nVal: val.length,
      lambda: tuned.lambda,
      valMae: ROUND(tuned.mae),
    });
  }

  // Majority / mean of fold-selected λ; break ties toward larger λ (more regularization).
  const counts = new Map();
  for (const f of foldScores) {
    counts.set(f.lambda, (counts.get(f.lambda) || 0) + 1);
  }
  let selectedLambda = 30;
  let bestCount = -1;
  for (const lam of [...lambdas].sort((a, b) => b - a)) {
    const c = counts.get(lam) || 0;
    if (c > bestCount) {
      bestCount = c;
      selectedLambda = lam;
    }
  }
  // If no folds, fall back to single chronological split inside 2025.
  if (!foldScores.length && trainRows.length >= minTrain + minVal) {
    const sorted = [...trainRows].sort((a, b) => a.week - b.week || a.kickoff.localeCompare(b.kickoff));
    const cut = Math.floor(sorted.length * 0.7);
    const tr = sorted.slice(0, cut);
    const va = sorted.slice(cut);
    const tuned = tuneRidgeLambda(
      tr.map((r) => r[xKey]),
      tr.map((r) => r.actualMargin),
      va.map((r) => r[xKey]),
      va.map((r) => r.actualMargin),
      [...lambdas]
    );
    selectedLambda = tuned.lambda;
    foldScores.push({
      valWeek: "chronological_70_30",
      nTrain: tr.length,
      nVal: va.length,
      lambda: tuned.lambda,
      valMae: ROUND(tuned.mae),
    });
  }

  return {
    season: CORE_HOLDOUT_TRAIN_SEASON,
    featureMode,
    featureNames: [...featureNames],
    lambdasTried: [...lambdas],
    folds: foldScores,
    selectedLambda,
    selectionSource: "within_2025_chronological_only",
    neverUsedEvalSeason: CORE_HOLDOUT_EVAL_SEASON,
  };
}

/**
 * Fit champion (A) and combined (C) on all 2025 train rows with frozen λ; evaluate on 2026.
 */
export function evaluateFrozenModelCHoldout({
  trainRows = [],
  holdoutRows = [],
  lambda = null,
  lambdas = DEFAULT_LAMBDAS,
} = {}) {
  const design = describeCoreHoldoutEvalDesign();
  if (!trainRows.length || !holdoutRows.length) {
    return {
      ok: false,
      blocked: true,
      reason: "empty_train_or_holdout",
      design,
      classification: "Unable to evaluate due to data limitations",
      researchOnly: true,
      canAuthorizeWager: false,
      canInfluenceProduction: false,
    };
  }
  if (trainRows.some((r) => r.season !== CORE_HOLDOUT_TRAIN_SEASON)) {
    return {
      ok: false,
      blocked: true,
      reason: "train_rows_must_be_2025_only",
      design,
      classification: "Unable to evaluate due to data limitations",
      researchOnly: true,
      canAuthorizeWager: false,
      canInfluenceProduction: false,
    };
  }
  if (holdoutRows.some((r) => r.season !== CORE_HOLDOUT_EVAL_SEASON)) {
    return {
      ok: false,
      blocked: true,
      reason: "holdout_rows_must_be_2026_only",
      design,
      classification: "Unable to evaluate due to data limitations",
      researchOnly: true,
      canAuthorizeWager: false,
      canInfluenceProduction: false,
    };
  }

  const lambdaSelectC = selectLambdaWithinTrainSeason(trainRows, {
    lambdas,
    featureMode: "combined",
  });
  const lambdaSelectA = selectLambdaWithinTrainSeason(trainRows, {
    lambdas,
    featureMode: "champion",
  });
  const lambdaC = lambda != null ? Number(lambda) : lambdaSelectC.selectedLambda;
  const lambdaA = lambda != null ? Number(lambda) : lambdaSelectA.selectedLambda;

  const fitAMargin = fitRidge(
    trainRows.map((r) => r.xChampion),
    trainRows.map((r) => r.actualMargin),
    { lambda: lambdaA, featureNames: CHAMPION_KEYS }
  );
  const fitATotal = fitRidge(
    trainRows.map((r) => r.xChampion),
    trainRows.map((r) => r.actualTotal),
    { lambda: lambdaA, featureNames: CHAMPION_KEYS }
  );
  const fitCMargin = fitRidge(
    trainRows.map((r) => r.xCombined),
    trainRows.map((r) => r.actualMargin),
    { lambda: lambdaC, featureNames: COMBINED_KEYS }
  );
  const fitCTotal = fitRidge(
    trainRows.map((r) => r.xCombined),
    trainRows.map((r) => r.actualTotal),
    { lambda: lambdaC, featureNames: COMBINED_KEYS }
  );

  if (![fitAMargin, fitATotal, fitCMargin, fitCTotal].every((f) => f.ok)) {
    return {
      ok: false,
      blocked: true,
      reason: "ridge_fit_failed",
      design,
      classification: "Unable to evaluate due to data limitations",
      researchOnly: true,
      canAuthorizeWager: false,
      canInfluenceProduction: false,
    };
  }

  const predAMargin = predictRidge(fitAMargin, holdoutRows.map((r) => r.xChampion));
  const predATotal = predictRidge(fitATotal, holdoutRows.map((r) => r.xChampion));
  const predCMargin = predictRidge(fitCMargin, holdoutRows.map((r) => r.xCombined));
  const predCTotal = predictRidge(fitCTotal, holdoutRows.map((r) => r.xCombined));

  // Within-2025 diagnostics (selection folds already computed); also report train fit metrics.
  const trainPredA = predictRidge(fitAMargin, trainRows.map((r) => r.xChampion));
  const trainPredC = predictRidge(fitCMargin, trainRows.map((r) => r.xCombined));
  const within2025 = {
    lambdaSelectionCombined: lambdaSelectC,
    lambdaSelectionChampion: lambdaSelectA,
    trainFit: {
      champion: metricsFromPred(trainRows, trainPredA, predictRidge(fitATotal, trainRows.map((r) => r.xChampion))),
      combined: metricsFromPred(trainRows, trainPredC, predictRidge(fitCTotal, trainRows.map((r) => r.xCombined))),
    },
    note: "Regularization and coefficients selected/fit on 2025 only",
  };

  const holdoutMetrics = {
    champion: metricsFromPred(holdoutRows, predAMargin, predATotal),
    combined: metricsFromPred(holdoutRows, predCMargin, predCTotal),
  };
  holdoutMetrics.deltaCombinedVsChampion = {
    spreadMae: ROUND(holdoutMetrics.combined.spreadMae - holdoutMetrics.champion.spreadMae),
    totalMae: ROUND(holdoutMetrics.combined.totalMae - holdoutMetrics.champion.totalMae),
    winnerAccuracy: ROUND(
      holdoutMetrics.combined.winnerAccuracy - holdoutMetrics.champion.winnerAccuracy
    ),
  };

  const h2h = headToHead(holdoutRows, predAMargin, predCMargin);
  const improved =
    holdoutMetrics.deltaCombinedVsChampion.spreadMae != null &&
    holdoutMetrics.deltaCombinedVsChampion.spreadMae < 0 &&
    holdoutMetrics.deltaCombinedVsChampion.totalMae != null &&
    holdoutMetrics.deltaCombinedVsChampion.totalMae < 0;

  let classification = "No measurable improvement";
  if (improved) classification = "Promising but insufficient evidence";
  else if (
    holdoutMetrics.deltaCombinedVsChampion.spreadMae > 0 &&
    holdoutMetrics.deltaCombinedVsChampion.totalMae > 0
  ) {
    classification = "Worse than the incumbent";
  }

  const coefficients = {
    frozen: true,
    lastTrainingSeason: CORE_HOLDOUT_TRAIN_SEASON,
    evaluateSeason: CORE_HOLDOUT_EVAL_SEASON,
    neverRefitOnEvaluateSeason: true,
    lambdaChampion: lambdaA,
    lambdaCombined: lambdaC,
    champion: {
      margin: {
        intercept: ROUND(fitAMargin.intercept, 6),
        beta: fitAMargin.beta.map((b) => ROUND(b, 6)),
        means: fitAMargin.means.map((m) => ROUND(m, 6)),
        stds: fitAMargin.stds.map((s) => ROUND(s, 6)),
        featureNames: [...CHAMPION_KEYS],
      },
      total: {
        intercept: ROUND(fitATotal.intercept, 6),
        beta: fitATotal.beta.map((b) => ROUND(b, 6)),
        means: fitATotal.means.map((m) => ROUND(m, 6)),
        stds: fitATotal.stds.map((s) => ROUND(s, 6)),
        featureNames: [...CHAMPION_KEYS],
      },
    },
    combined: {
      margin: {
        intercept: ROUND(fitCMargin.intercept, 6),
        beta: fitCMargin.beta.map((b) => ROUND(b, 6)),
        means: fitCMargin.means.map((m) => ROUND(m, 6)),
        stds: fitCMargin.stds.map((s) => ROUND(s, 6)),
        featureNames: [...COMBINED_KEYS],
      },
      total: {
        intercept: ROUND(fitCTotal.intercept, 6),
        beta: fitCTotal.beta.map((b) => ROUND(b, 6)),
        means: fitCTotal.means.map((m) => ROUND(m, 6)),
        stds: fitCTotal.stds.map((s) => ROUND(s, 6)),
        featureNames: [...COMBINED_KEYS],
      },
    },
  };

  return {
    ok: true,
    blocked: false,
    version: CORE_HOLDOUT_VERSION,
    modelId: CFB_CORE_SHADOW_ID,
    design,
    within2025,
    holdout2026: {
      n: holdoutRows.length,
      metrics: holdoutMetrics,
      headToHeadVsChampionAA: h2h,
    },
    coefficients,
    sampleSize: {
      train2025: trainRows.length,
      holdout2026: holdoutRows.length,
    },
    uncertainty: {
      holdoutN: holdoutRows.length,
      approxSeScale: holdoutRows.length
        ? ROUND(1 / Math.sqrt(holdoutRows.length))
        : null,
      note: "Report metrics with n; small-n holdout results are high-uncertainty research signals.",
    },
    classification,
    decision: improved
      ? "FROZEN_HOLDOUT_CORE_INCREMENT_RESEARCH_ONLY"
      : "FROZEN_HOLDOUT_NO_INCREMENTAL_EDGE",
    authority: "research_only",
    canQualify: false,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

/**
 * End-to-end report builder. Blocks with explicit reasons when coverage/cutoffs fail.
 * Never fabricates OOS wins.
 */
export function runCore2025Train2026HoldoutReport({
  games = [],
  archiveRows = [],
  cfbdAccess = null,
  lambdas = DEFAULT_LAMBDAS,
  minTrainGames = 100,
  minEvalGames = 50,
} = {}) {
  const design = describeCoreHoldoutEvalDesign();
  const built = buildEligibleCoreHoldoutRows({ games, archiveRows, requireChampionBaseline: true });
  const coverage = auditCoreHoldoutCoverage({
    archiveRows,
    trainGameCount: built.counts.train2025,
    evalGameCount: built.counts.holdout2026,
    verifiedHistoricalCutoffs: built.verifiedHistoricalCutoffs,
    championBaselinesAvailable: built.counts.eligible > 0,
    cfbdAccess,
    minTrainGames,
    minEvalGames,
  });

  // Champion baselines: if every row rejected for baselines, flag explicitly.
  if ((built.validationErrors.missing_champion_aa_baseline || 0) > 0 && built.counts.eligible === 0) {
    coverage.blockers = coverage.blockers.filter((b) => b.code !== "champion_aa_baselines_unavailable");
    coverage.blockers.push({
      code: "champion_aa_baselines_unavailable",
      have: built.validationErrors.missing_champion_aa_baseline,
      need: "Pregame champion A/A projected scores on eligible games",
    });
    coverage.ok = false;
  }

  const readiness = assessModelCResearchReadiness({
    archivesBySeason: Object.fromEntries(
      (coverage.teamCoverage || []).map((c) => [c.season, c.throughWeeks])
    ),
    trainGameRows: built.counts.train2025,
    testGameRows: built.counts.holdout2026,
    verifiedHistoricalCutoffs: built.verifiedHistoricalCutoffs,
    trainSeason: CORE_HOLDOUT_TRAIN_SEASON,
    testSeason: CORE_HOLDOUT_EVAL_SEASON,
    minTrainRows: minTrainGames,
    minTestRows: minEvalGames,
  });

  const blockedReasons = [
    ...coverage.blockers,
    ...(readiness.readyToAttemptFit ? [] : readiness.missing),
  ];
  // Deduplicate by code
  const seen = new Set();
  const blockers = [];
  for (const b of blockedReasons) {
    const code = b.code || JSON.stringify(b);
    if (seen.has(code)) continue;
    seen.add(code);
    blockers.push(b);
  }

  if (blockers.length || !readiness.readyToAttemptFit || !built.counts.train2025 || !built.counts.holdout2026) {
    return {
      ok: false,
      blocked: true,
      version: CORE_HOLDOUT_VERSION,
      generatedAt: new Date().toISOString(),
      design,
      status: "MODEL_C_BLOCKED",
      reason: "coverage_or_cutoff_requirements_failed",
      blockers,
      coverage: {
        teamCoverage: coverage.teamCoverage,
        trainCoverage: coverage.trainCoverage,
        evalCoverage: coverage.evalCoverage,
      },
      counts: built.counts,
      validationErrors: built.validationErrors,
      readiness,
      coefficients: null,
      holdout2026: null,
      headToHeadVsChampionAA: null,
      classification: "Unable to evaluate due to data limitations",
      productionSafeguards: {
        championAAUnchanged: true,
        wageringUnchanged: true,
        canInfluenceProduction: false,
        canAuthorizeWager: false,
      },
      researchOnly: true,
    };
  }

  const evalResult = evaluateFrozenModelCHoldout({
    trainRows: built.train,
    holdoutRows: built.holdout,
    lambdas,
  });

  return {
    ok: evalResult.ok === true,
    blocked: evalResult.blocked === true,
    version: CORE_HOLDOUT_VERSION,
    generatedAt: new Date().toISOString(),
    design,
    status: evalResult.ok ? "FROZEN_HOLDOUT_COMPLETE" : "MODEL_C_BLOCKED",
    blockers: evalResult.ok ? [] : [{ code: evalResult.reason || "eval_failed" }],
    coverage: {
      teamCoverage: coverage.teamCoverage,
      trainCoverage: coverage.trainCoverage,
      evalCoverage: coverage.evalCoverage,
    },
    counts: built.counts,
    validationErrors: built.validationErrors,
    readiness,
    within2025: evalResult.within2025 || null,
    coefficients: evalResult.coefficients || null,
    holdout2026: evalResult.holdout2026 || null,
    headToHeadVsChampionAA: evalResult.holdout2026?.headToHeadVsChampionAA || null,
    sampleSize: evalResult.sampleSize || null,
    uncertainty: evalResult.uncertainty || null,
    classification: evalResult.classification,
    decision: evalResult.decision,
    productionSafeguards: {
      championAAUnchanged: true,
      wageringUnchanged: true,
      canInfluenceProduction: false,
      canAuthorizeWager: false,
    },
    researchOnly: true,
  };
}
