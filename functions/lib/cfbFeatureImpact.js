/**
 * Feature-family impact / ablation measurements.
 *
 * Distinguishes:
 * 1) Numerical contribution under the *fitted* champion (zeroing a field ≠ predictive value).
 * 2) Incremental predictive usefulness — requires correctly refitted models + OOS eval.
 *
 * Unfitted families report sensitivity deltas with predictiveEvidence: "unproven".
 */

import {
  projectModelA,
  projectModelB,
  projectModelC,
  projectModelD,
  projectModelE,
} from "./cfbCurrentSeasonChallengers.js";
import { instrumentProjectionContribution } from "./cfbFeatureContract.js";

export const FEATURE_IMPACT_VERSION = "cfb-feature-impact-v1";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function cloneGame(game) {
  return JSON.parse(JSON.stringify(game || {}));
}

function stripFamily(game, family) {
  const g = cloneGame(game);
  const home = g.cfbFbisV2Input?.home || {};
  const away = g.cfbFbisV2Input?.away || {};
  const strip = (side, keys) => {
    for (const k of keys) {
      delete side[k];
    }
  };
  if (family === "current_season_efficiency") {
    strip(home, ["offensePpa", "defensePpa", "ppaOff", "ppaDef"]);
    strip(away, ["offensePpa", "defensePpa", "ppaOff", "ppaDef"]);
  } else if (family === "passing_rushing") {
    strip(home, ["ppaPass", "ppaRush", "ppaPassAllowed", "ppaRushAllowed", "passEpa", "rushEpa"]);
    strip(away, ["ppaPass", "ppaRush", "ppaPassAllowed", "ppaRushAllowed", "passEpa", "rushEpa"]);
  } else if (family === "success_explosiveness") {
    strip(home, [
      "offensiveSuccessRate",
      "defensiveSuccessRate",
      "offensiveExplosiveness",
      "defensiveExplosiveness",
      "successRate",
    ]);
    strip(away, [
      "offensiveSuccessRate",
      "defensiveSuccessRate",
      "offensiveExplosiveness",
      "defensiveExplosiveness",
      "successRate",
    ]);
  } else if (family === "trenches_havoc") {
    strip(home, ["offensiveLineYards", "defensiveLineYards", "offensiveHavoc", "defensiveHavoc", "havocRate"]);
    strip(away, ["offensiveLineYards", "defensiveLineYards", "offensiveHavoc", "defensiveHavoc", "havocRate"]);
  } else if (family === "drive_situational") {
    strip(home, ["offensivePointsPerOpportunity", "defensivePointsPerOpportunity", "pointsPerOpportunity"]);
    strip(away, ["offensivePointsPerOpportunity", "defensivePointsPerOpportunity", "pointsPerOpportunity"]);
  } else if (family === "qb_personnel") {
    strip(home, ["talent", "returningPpa"]);
    strip(away, ["talent", "returningPpa"]);
  } else if (family === "opponent_adjusted") {
    strip(home, ["sp", "fpi", "srs", "elo"]);
    strip(away, ["sp", "fpi", "srs", "elo"]);
  } else if (family === "core") {
    strip(home, ["core", "coreOffense", "coreDefense", "coreThroughWeek"]);
    strip(away, ["core", "coreOffense", "coreDefense", "coreThroughWeek"]);
  } else if (family === "sdv") {
    strip(home, ["sdvNetAdjEpa", "sdvAdjOffEpa", "sdvAdjDefEpa", "net_adj_epa"]);
    strip(away, ["sdvNetAdjEpa", "sdvAdjOffEpa", "sdvAdjDefEpa", "net_adj_epa"]);
  } else if (family === "priors") {
    strip(home, ["priorOff", "priorDef"]);
    strip(away, ["priorOff", "priorDef"]);
  } else if (family === "games_played") {
    strip(home, ["gamesPlayed", "gamesPlayedSource"]);
    strip(away, ["gamesPlayed", "gamesPlayedSource"]);
  }
  g.cfbFbisV2Input = { home, away };
  return g;
}

function deltaRow(label, baseline, variant, meta = {}) {
  if (!baseline?.ok || !variant?.ok) {
    return {
      featureFamily: label,
      homePtsChange: null,
      awayPtsChange: null,
      marginChange: null,
      totalChange: null,
      winProbChange: null,
      uncertaintyChange: null,
      historicalAccuracyImpact: meta.predictiveEvidence || "unavailable",
      ...meta,
    };
  }
  return {
    featureFamily: label,
    homePtsChange: round2(variant.home - baseline.home),
    awayPtsChange: round2(variant.away - baseline.away),
    marginChange: round2((variant.home - variant.away) - (baseline.home - baseline.away)),
    totalChange: round2((variant.home + variant.away) - (baseline.home + baseline.away)),
    winProbChange: null,
    uncertaintyChange: null,
    historicalAccuracyImpact: meta.predictiveEvidence || "sensitivity_only_not_predictive_proof",
    ...meta,
  };
}

function defaultGame() {
  return {
    home: "Home",
    away: "Away",
    season: 2026,
    week: 8,
    start: "2026-10-20T23:00:00.000Z",
    cfbFbisV2Input: {
      home: {
        offensePpa: -0.04,
        defensePpa: -0.16,
        gamesPlayed: 6,
        gamesPlayedSource: "schedule",
        priorOff: 34.6,
        priorDef: 22.1,
        ppaPass: 0.12,
        ppaRush: -0.02,
        offensiveSuccessRate: 0.42,
        defensiveSuccessRate: 0.39,
        offensiveExplosiveness: 1.1,
        offensiveLineYards: 3.2,
        offensiveHavoc: 0.14,
        offensivePointsPerOpportunity: 4.1,
        talent: 750,
        returningPpa: 0.4,
        sp: 12,
        coreOffense: -4.7,
        coreDefense: 2.1,
        coreThroughWeek: 7,
        sdvNetAdjEpa: 0.05,
      },
      away: {
        offensePpa: 0.05,
        defensePpa: -0.02,
        gamesPlayed: 6,
        gamesPlayedSource: "schedule",
        priorOff: 28,
        priorDef: 24,
        ppaPass: 0.08,
        ppaRush: 0.01,
        offensiveSuccessRate: 0.4,
        coreOffense: 1.2,
        sdvNetAdjEpa: -0.01,
      },
    },
  };
}

/**
 * Ablation table for one matchup under Model A (fitted) + research notes for B–E.
 */
export function runFeatureImpactAblation({ game = null } = {}) {
  const g = game || defaultGame();
  const baselineA = projectModelA(g);
  const contribution = baselineA?.ok ? instrumentProjectionContribution(baselineA, g) : null;

  const families = [
    {
      id: "current_season_efficiency",
      label: "Current-season efficiency (PPA)",
      fittedInChampion: true,
      predictiveEvidence: "fitted_champion_contribution_reproducible",
    },
    {
      id: "priors",
      label: "Historical priors",
      fittedInChampion: true,
      predictiveEvidence: "fitted_champion_contribution_reproducible",
    },
    {
      id: "games_played",
      label: "Games played / shrink weight",
      fittedInChampion: true,
      predictiveEvidence: "fitted_champion_contribution_reproducible",
    },
    {
      id: "passing_rushing",
      label: "Passing/rushing matchups",
      fittedInChampion: false,
      predictiveEvidence: "unproven_zero_AA_coefficient",
    },
    {
      id: "success_explosiveness",
      label: "Success and explosiveness",
      fittedInChampion: false,
      predictiveEvidence: "unproven_zero_AA_coefficient",
    },
    {
      id: "trenches_havoc",
      label: "Trenches and havoc",
      fittedInChampion: false,
      predictiveEvidence: "unproven_zero_AA_coefficient",
    },
    {
      id: "drive_situational",
      label: "Drive / situational efficiency",
      fittedInChampion: false,
      predictiveEvidence: "unproven_zero_AA_coefficient",
    },
    {
      id: "qb_personnel",
      label: "QB / personnel",
      fittedInChampion: false,
      predictiveEvidence: "unproven_not_in_fitted_model",
    },
    {
      id: "opponent_adjusted",
      label: "Opponent-adjusted ratings (SP/FPI/SRS/Elo)",
      fittedInChampion: false,
      predictiveEvidence: "unproven_not_in_fitted_model",
    },
    {
      id: "core",
      label: "CORE",
      fittedInChampion: false,
      predictiveEvidence: "unproven_pending_fitted_oos_artifact",
    },
    {
      id: "sdv",
      label: "SDV-derived",
      fittedInChampion: false,
      predictiveEvidence: "unproven_sdv_never_enters_fitted_champion",
    },
  ];

  const table = [];
  for (const fam of families) {
    const ablated = stripFamily(g, fam.id);
    const variant = projectModelA(ablated);
    table.push(
      deltaRow(fam.label, baselineA, variant, {
        familyId: fam.id,
        fittedInChampion: fam.fittedInChampion,
        predictiveEvidence: fam.predictiveEvidence,
        method: fam.fittedInChampion
          ? "ablate_input_under_fitted_coefficients"
          : "ablate_input_expect_near_zero_delta_until_refit",
        note: fam.fittedInChampion
          ? "Delta measures numerical contribution under fitted A/A — not incremental OOS accuracy"
          : "Zero/near-zero delta expected; do not treat as predictive proof",
      })
    );
  }

  // Model B fitted pass/rush research package — numerical only
  const b = projectModelB(g);
  table.push(
    deltaRow("Model B pass/rush fitted (research)", baselineA, b, {
      familyId: "model_b_pass_rush",
      fittedInChampion: false,
      predictiveEvidence: b.oosDecision || "NO_OOS_IMPROVEMENT_VS_CHAMPION_A",
      method: "fitted_research_ridge_ablation_B",
    })
  );

  const c = projectModelC(g, { coreArtifact: null });
  table.push({
    featureFamily: "Model C + CORE",
    homePtsChange: null,
    awayPtsChange: null,
    marginChange: null,
    totalChange: null,
    historicalAccuracyImpact: "unproven_no_fitted_core_artifact",
    familyId: "model_c",
    ok: c.ok,
    reason: c.reason,
  });

  const d = projectModelD(g);
  table.push({
    featureFamily: "Model D + SDV",
    homePtsChange: null,
    awayPtsChange: null,
    marginChange: null,
    totalChange: null,
    historicalAccuracyImpact: "unproven_no_fitted_sdv_artifact",
    familyId: "model_d",
    ok: d.ok,
    reason: d.reason,
  });

  const e = projectModelE(g);
  table.push(
    deltaRow("Model E combined advanced fitted (research)", baselineA, e, {
      familyId: "model_e",
      fittedInChampion: false,
      predictiveEvidence: e.oosDecision || "NO_OOS_IMPROVEMENT_VS_CHAMPION_A",
      method: "fitted_research_ridge_ablation_F",
    })
  );

  const nonzeroFitted = table.filter(
    (r) =>
      r.fittedInChampion &&
      ((num(r.homePtsChange) || 0) !== 0 ||
        (num(r.awayPtsChange) || 0) !== 0 ||
        (num(r.marginChange) || 0) !== 0)
  );

  return {
    version: FEATURE_IMPACT_VERSION,
    baseline: baselineA?.ok
      ? { home: baselineA.home, away: baselineA.away, margin: baselineA.margin, total: baselineA.total }
      : null,
    contribution,
    table,
    nonzeroFittedContributions: nonzeroFitted,
    reproducible: Boolean(baselineA?.ok) && nonzeroFitted.length > 0,
    caveats: [
      "Ablating unfitted families under fixed coefficients does not prove predictive value.",
      "Claimed accuracy gains require leakage-safe refits + matched OOS evaluation.",
      "Model C blocked until fitted CORE OOS artifact exists; Model D until SDV artifact.",
      "Fitted B/E packages exist but do not beat champion A/A beyond practical ε — no promotion.",
    ],
  };
}
