/**
 * Deep evaluation helpers for FBIS CORE vs production A/A.
 * Research-only — never promotes champion or authorizes wagers.
 *
 * Distinguishes three benchmarks on the same holdout rows:
 *   - rawProductionAA: frozen proj_home/proj_away as-is
 *   - modelA: ridge fitted on champion baseline features (2025 train)
 *   - modelC: ridge fitted on CORE+baseline features (2025 train)
 *   - marginOnlyHybrid: Model C margin + raw A/A total → reconstructed scores
 */

import { fitRidge, predictRidge, mae } from "./cfbFbisV2Fit.js";
import { CFB_CORE_FEATURE_KEYS } from "./cfbCoreChallenger.js";
import {
  fitMarginResidualArtifact,
  fitModelCMarginAaTotalArtifact,
  marginHybridPredictionsForRows,
  describeCfbCoreMarginHybrid,
  evaluateMarginHybridPromotion,
  CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING,
  CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL,
} from "./cfbCoreMarginHybrid.js";

const CHAMPION_KEYS = Object.freeze(["baselineMargin", "baselineTotal"]);
const ROUND = (x, d = 4) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function scoresFromMarginTotal(margin, total) {
  const home = (total + margin) / 2;
  const away = (total - margin) / 2;
  return { home, away, margin, total };
}

export function rawProductionAaPredictions(rows = []) {
  return rows.map((r) => {
    const home = Number(r.baselineHome);
    const away = Number(r.baselineAway);
    return {
      home,
      away,
      margin: home - away,
      total: home + away,
      source: "raw_production_aa_frozen",
    };
  });
}

export function metricsAgainstActuals(rows, preds) {
  const yM = rows.map((r) => r.actualMargin);
  const yT = rows.map((r) => r.actualTotal);
  const predM = preds.map((p) => p.margin);
  const predT = preds.map((p) => p.total);
  let correct = 0;
  let decided = 0;
  for (let i = 0; i < rows.length; i++) {
    if (yM[i] === 0) continue;
    decided += 1;
    if ((predM[i] >= 0 ? 1 : 0) === (yM[i] > 0 ? 1 : 0)) correct += 1;
  }
  const homeMae = mae(
    rows.map((r) => r.actualHome),
    preds.map((p) => p.home)
  );
  const awayMae = mae(
    rows.map((r) => r.actualAway),
    preds.map((p) => p.away)
  );
  return {
    n: rows.length,
    decided,
    spreadMae: ROUND(mae(yM, predM)),
    totalMae: ROUND(mae(yT, predT)),
    homeMae: ROUND(homeMae),
    awayMae: ROUND(awayMae),
    winnerAccuracy: decided ? ROUND(correct / decided) : null,
  };
}

function summarizeBootDeltas(deltas, { alpha, nBoot, method, nClusters = null }) {
  const summarize = (arr) => {
    const sorted = [...arr].filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const lo = sorted[Math.floor((alpha / 2) * sorted.length)];
    const hi = sorted[Math.min(sorted.length - 1, Math.floor((1 - alpha / 2) * sorted.length))];
    const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
    const excludesZero =
      Number.isFinite(lo) && Number.isFinite(hi) && ((lo > 0 && hi > 0) || (lo < 0 && hi < 0));
    return {
      mean: ROUND(mean),
      ciLow: ROUND(lo),
      ciHigh: ROUND(hi),
      alpha,
      nBoot,
      method,
      nClusters,
      ciExcludesZero: excludesZero,
    };
  };
  return {
    spreadMaeDelta: summarize(deltas.spreadMae),
    totalMaeDelta: summarize(deltas.totalMae),
    winnerAccuracyDelta: summarize(deltas.winnerAccuracy),
    homeMaeDelta: summarize(deltas.homeMae),
    awayMaeDelta: summarize(deltas.awayMae),
    note: "Delta = challenger − champion. For MAE, negative favors challenger. For winnerAccuracy, positive favors challenger.",
  };
}

/**
 * Paired IID bootstrap CIs for metric deltas (challenger − champion).
 * Resamples games independently with replacement. May understate variance
 * when within-week outcomes are correlated — prefer weekClustered as well.
 */
export function bootstrapPairedMetricDeltas(
  rows,
  challengerPreds,
  championPreds,
  {
    nBoot = 2000,
    seed = 42,
    alpha = 0.05,
  } = {}
) {
  const rng = mulberry32(seed);
  const n = rows.length;
  const deltas = { spreadMae: [], totalMae: [], winnerAccuracy: [], homeMae: [], awayMae: [] };

  for (let b = 0; b < nBoot; b++) {
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(Math.floor(rng() * n));
    const sampleRows = idx.map((i) => rows[i]);
    const sampleC = idx.map((i) => challengerPreds[i]);
    const sampleA = idx.map((i) => championPreds[i]);
    const mC = metricsAgainstActuals(sampleRows, sampleC);
    const mA = metricsAgainstActuals(sampleRows, sampleA);
    deltas.spreadMae.push(mC.spreadMae - mA.spreadMae);
    deltas.totalMae.push(mC.totalMae - mA.totalMae);
    deltas.winnerAccuracy.push(mC.winnerAccuracy - mA.winnerAccuracy);
    deltas.homeMae.push(mC.homeMae - mA.homeMae);
    deltas.awayMae.push(mC.awayMae - mA.awayMae);
  }

  return summarizeBootDeltas(deltas, { alpha, nBoot, method: "paired_iid_games" });
}

/**
 * Week-clustered bootstrap: resample entire schedule weeks with replacement.
 * Accounts for within-week correlation (same slate / weather / common shocks).
 */
export function bootstrapWeekClusteredMetricDeltas(
  rows,
  challengerPreds,
  championPreds,
  {
    nBoot = 2000,
    seed = 42,
    alpha = 0.05,
  } = {}
) {
  const rng = mulberry32(seed);
  const byWeek = new Map();
  for (let i = 0; i < rows.length; i++) {
    const w = rows[i].week;
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(i);
  }
  const weeks = [...byWeek.keys()];
  const deltas = { spreadMae: [], totalMae: [], winnerAccuracy: [], homeMae: [], awayMae: [] };

  for (let b = 0; b < nBoot; b++) {
    const idx = [];
    for (let k = 0; k < weeks.length; k++) {
      const w = weeks[Math.floor(rng() * weeks.length)];
      idx.push(...byWeek.get(w));
    }
    if (!idx.length) continue;
    const sampleRows = idx.map((i) => rows[i]);
    const sampleC = idx.map((i) => challengerPreds[i]);
    const sampleA = idx.map((i) => championPreds[i]);
    const mC = metricsAgainstActuals(sampleRows, sampleC);
    const mA = metricsAgainstActuals(sampleRows, sampleA);
    deltas.spreadMae.push(mC.spreadMae - mA.spreadMae);
    deltas.totalMae.push(mC.totalMae - mA.totalMae);
    deltas.winnerAccuracy.push(mC.winnerAccuracy - mA.winnerAccuracy);
    deltas.homeMae.push(mC.homeMae - mA.homeMae);
    deltas.awayMae.push(mC.awayMae - mA.awayMae);
  }

  return summarizeBootDeltas(deltas, {
    alpha,
    nBoot,
    method: "week_clustered",
    nClusters: weeks.length,
  });
}

/**
 * Independent recomputation of one bootstrap replicate for audit/tests.
 * Returns the same delta object metricsAgainstActuals would produce for a
 * given index draw — used to validate the CI machinery without trusting
 * a single opaque path.
 */
export function bootstrapReplicateDelta(rows, challengerPreds, championPreds, indices) {
  const sampleRows = indices.map((i) => rows[i]);
  const sampleC = indices.map((i) => challengerPreds[i]);
  const sampleA = indices.map((i) => championPreds[i]);
  const mC = metricsAgainstActuals(sampleRows, sampleC);
  const mA = metricsAgainstActuals(sampleRows, sampleA);
  return {
    spreadMae: ROUND(mC.spreadMae - mA.spreadMae),
    totalMae: ROUND(mC.totalMae - mA.totalMae),
    winnerAccuracy: ROUND(mC.winnerAccuracy - mA.winnerAccuracy),
    n: sampleRows.length,
  };
}

export function fitHoldoutModels(trainRows, holdoutRows, { lambdaChampion = 1, lambdaCombined = 1 } = {}) {
  const fitAMargin = fitRidge(
    trainRows.map((r) => r.xChampion),
    trainRows.map((r) => r.actualMargin),
    { lambda: lambdaChampion, featureNames: CHAMPION_KEYS }
  );
  const fitATotal = fitRidge(
    trainRows.map((r) => r.xChampion),
    trainRows.map((r) => r.actualTotal),
    { lambda: lambdaChampion, featureNames: CHAMPION_KEYS }
  );
  const fitCMargin = fitRidge(
    trainRows.map((r) => r.xCombined),
    trainRows.map((r) => r.actualMargin),
    { lambda: lambdaCombined, featureNames: CFB_CORE_FEATURE_KEYS }
  );
  const fitCTotal = fitRidge(
    trainRows.map((r) => r.xCombined),
    trainRows.map((r) => r.actualTotal),
    { lambda: lambdaCombined, featureNames: CFB_CORE_FEATURE_KEYS }
  );

  const predAMargin = predictRidge(fitAMargin, holdoutRows.map((r) => r.xChampion));
  const predATotal = predictRidge(fitATotal, holdoutRows.map((r) => r.xChampion));
  const predCMargin = predictRidge(fitCMargin, holdoutRows.map((r) => r.xCombined));
  const predCTotal = predictRidge(fitCTotal, holdoutRows.map((r) => r.xCombined));

  const modelA = predAMargin.map((margin, i) =>
    scoresFromMarginTotal(margin, predATotal[i])
  );
  const modelC = predCMargin.map((margin, i) =>
    scoresFromMarginTotal(margin, predCTotal[i])
  );
  // Margin-only hybrid: CORE margin + raw A/A total
  const raw = rawProductionAaPredictions(holdoutRows);
  const marginOnlyHybrid = predCMargin.map((margin, i) => ({
    ...scoresFromMarginTotal(margin, raw[i].total),
    source: "model_c_margin_plus_raw_aa_total",
  }));

  return {
    lambdas: { lambdaChampion, lambdaCombined },
    fits: { fitAMargin, fitATotal, fitCMargin, fitCTotal },
    predictions: { modelA, modelC, rawProductionAA: raw, marginOnlyHybrid },
  };
}

export function classifyMatchupType(row) {
  const hc = String(row.homeConference || "").trim();
  const ac = String(row.awayConference || "").trim();
  if (row.neutralSite) return "neutral_site";
  if (hc && ac && hc === ac) return "intra_conference";
  if (hc && ac && hc !== ac) return "inter_conference";
  return "unknown";
}

export function classifyFavoriteDog(row, aaMargin) {
  // Favorite from production A/A perspective (home favorite if aaMargin > 0)
  const actual = row.actualMargin;
  if (!Number.isFinite(aaMargin) || aaMargin === 0) return "pickem_aa";
  const favHome = aaMargin > 0;
  const favCovered = favHome ? actual > 0 : actual < 0;
  return {
    side: favHome ? "home_favorite" : "away_favorite",
    bucket: Math.abs(aaMargin) >= 14 ? "large_spread" : Math.abs(aaMargin) >= 7 ? "medium_spread" : "small_spread",
    favoriteWon: favCovered,
  };
}

/**
 * Slice holdout metrics for challenger vs raw A/A.
 */
export function sliceHoldoutMetrics(rows, challengerPreds, championPreds, { by } = {}) {
  const groups = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rawM = Number(r.baselineHome) - Number(r.baselineAway);
    let key;
    if (by === "week") key = `week_${r.week}`;
    else if (by === "conference") {
      const hc = r.homeConference || "UNK";
      const ac = r.awayConference || "UNK";
      key = hc === ac ? `conf_${hc}` : `cross_${hc}_vs_${ac}`;
    } else if (by === "favorite_underdog") {
      const fd = classifyFavoriteDog(r, rawM);
      key = typeof fd === "string" ? fd : `${fd.side}|${fd.bucket}`;
    } else if (by === "matchup_type") key = classifyMatchupType(r);
    else key = "all";
    if (!groups.has(key)) groups.set(key, { idx: [] });
    groups.get(key).idx.push(i);
  }

  const out = [];
  for (const [key, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sampleRows = g.idx.map((i) => rows[i]);
    const sampleC = g.idx.map((i) => challengerPreds[i]);
    const sampleA = g.idx.map((i) => championPreds[i]);
    const mC = metricsAgainstActuals(sampleRows, sampleC);
    const mA = metricsAgainstActuals(sampleRows, sampleA);
    out.push({
      slice: key,
      n: sampleRows.length,
      challenger: mC,
      champion: mA,
      delta: {
        spreadMae: ROUND(mC.spreadMae - mA.spreadMae),
        totalMae: ROUND(mC.totalMae - mA.totalMae),
        winnerAccuracy: ROUND(mC.winnerAccuracy - mA.winnerAccuracy),
      },
    });
  }
  return out;
}

/**
 * Identify games where margin improvement is concentrated (largest |err_aa| − |err_c|).
 */
export function marginImprovementConcentration(rows, challengerPreds, championPreds, { topN = 10 } = {}) {
  const perGame = rows.map((r, i) => {
    const errC = Math.abs(challengerPreds[i].margin - r.actualMargin);
    const errA = Math.abs(championPreds[i].margin - r.actualMargin);
    return {
      gameId: r.gameId,
      week: r.week,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      actualMargin: r.actualMargin,
      challengerMargin: ROUND(challengerPreds[i].margin),
      championMargin: ROUND(championPreds[i].margin),
      absErrChallenger: ROUND(errC),
      absErrChampion: ROUND(errA),
      marginMaeImprovement: ROUND(errA - errC), // positive ⇒ challenger better
    };
  });
  const sorted = [...perGame].sort((a, b) => b.marginMaeImprovement - a.marginMaeImprovement);
  const positive = perGame.filter((g) => g.marginMaeImprovement > 0);
  const negative = perGame.filter((g) => g.marginMaeImprovement < 0);
  const totalPos = positive.reduce((s, g) => s + g.marginMaeImprovement, 0);
  const topShare =
    totalPos > 0
      ? ROUND(sorted.slice(0, topN).filter((g) => g.marginMaeImprovement > 0).reduce((s, g) => s + g.marginMaeImprovement, 0) / totalPos)
      : null;
  return {
    nImproved: positive.length,
    nWorsened: negative.length,
    nTied: perGame.length - positive.length - negative.length,
    topImprovers: sorted.slice(0, topN),
    topWorseners: sorted.slice(-topN).reverse(),
    topNShareOfPositiveImprovement: topShare,
    note: "topNShareOfPositiveImprovement = fraction of total positive margin-MAE gains coming from the top N games",
  };
}

export function answerDeepEvalQuestions({
  trainRows,
  holdoutRows,
  lambdaChampion = 1,
  lambdaCombined = 1,
  lambdaResidual = 1,
  nBoot = 2000,
  seed = 42,
} = {}) {
  const fitted = fitHoldoutModels(trainRows, holdoutRows, { lambdaChampion, lambdaCombined });
  const { modelA, modelC, rawProductionAA, marginOnlyHybrid } = fitted.predictions;

  // Leading candidate: Model C margin + A/A total (empirical best on historical holdout)
  const leadingArtifact = fitModelCMarginAaTotalArtifact(trainRows, {
    lambda: lambdaCombined,
    lastTrainingSeason: 2025,
  });
  const leadingHybrid = leadingArtifact.ok
    ? marginHybridPredictionsForRows(holdoutRows, leadingArtifact)
    : marginOnlyHybrid;

  // Sensitivity: CORE-only residual (mismatch-robust, historically weaker)
  const residualArtifact = fitMarginResidualArtifact(trainRows, {
    lambda: lambdaResidual,
    lastTrainingSeason: 2025,
  });
  const residualHybrid = residualArtifact.ok
    ? marginHybridPredictionsForRows(holdoutRows, residualArtifact)
    : null;

  const metrics = {
    rawProductionAA: metricsAgainstActuals(holdoutRows, rawProductionAA),
    modelA_fittedOnChampionFeatures: metricsAgainstActuals(holdoutRows, modelA),
    modelC_combined: metricsAgainstActuals(holdoutRows, modelC),
    marginOnlyHybrid_modelCMargin_aaTotal: metricsAgainstActuals(holdoutRows, leadingHybrid),
    marginResidualHybrid_sensitivity:
      residualHybrid && residualHybrid.every((p) => p.ok)
        ? metricsAgainstActuals(holdoutRows, residualHybrid)
        : null,
  };

  const bootIidC = bootstrapPairedMetricDeltas(holdoutRows, modelC, rawProductionAA, {
    nBoot,
    seed,
  });
  const bootWeekC = bootstrapWeekClusteredMetricDeltas(holdoutRows, modelC, rawProductionAA, {
    nBoot,
    seed: seed + 11,
  });

  const q1 = {
    question:
      "Does CORE beat the actual frozen production A/A on spread MAE, total MAE, and winner accuracy?",
    cohortN: holdoutRows.length,
    sameGames: true,
    benchmarks: {
      rawProductionAA: metrics.rawProductionAA,
      modelC: metrics.modelC_combined,
      modelA_researchFitted: metrics.modelA_fittedOnChampionFeatures,
      marginHybridLeading: metrics.marginOnlyHybrid_modelCMargin_aaTotal,
      marginResidualSensitivity: metrics.marginResidualHybrid_sensitivity,
    },
    deltasVsRawAA: {
      modelC: {
        spreadMae: ROUND(metrics.modelC_combined.spreadMae - metrics.rawProductionAA.spreadMae),
        totalMae: ROUND(metrics.modelC_combined.totalMae - metrics.rawProductionAA.totalMae),
        winnerAccuracy: ROUND(
          metrics.modelC_combined.winnerAccuracy - metrics.rawProductionAA.winnerAccuracy
        ),
        homeMae: ROUND(metrics.modelC_combined.homeMae - metrics.rawProductionAA.homeMae),
        awayMae: ROUND(metrics.modelC_combined.awayMae - metrics.rawProductionAA.awayMae),
      },
      modelA: {
        spreadMae: ROUND(
          metrics.modelA_fittedOnChampionFeatures.spreadMae - metrics.rawProductionAA.spreadMae
        ),
        totalMae: ROUND(
          metrics.modelA_fittedOnChampionFeatures.totalMae - metrics.rawProductionAA.totalMae
        ),
        winnerAccuracy: ROUND(
          metrics.modelA_fittedOnChampionFeatures.winnerAccuracy -
            metrics.rawProductionAA.winnerAccuracy
        ),
      },
      marginHybridLeading: {
        spreadMae: ROUND(
          metrics.marginOnlyHybrid_modelCMargin_aaTotal.spreadMae - metrics.rawProductionAA.spreadMae
        ),
        totalMae: ROUND(
          metrics.marginOnlyHybrid_modelCMargin_aaTotal.totalMae - metrics.rawProductionAA.totalMae
        ),
        winnerAccuracy: ROUND(
          metrics.marginOnlyHybrid_modelCMargin_aaTotal.winnerAccuracy -
            metrics.rawProductionAA.winnerAccuracy
        ),
      },
      marginResidualSensitivity: metrics.marginResidualHybrid_sensitivity
        ? {
            spreadMae: ROUND(
              metrics.marginResidualHybrid_sensitivity.spreadMae - metrics.rawProductionAA.spreadMae
            ),
            totalMae: ROUND(
              metrics.marginResidualHybrid_sensitivity.totalMae - metrics.rawProductionAA.totalMae
            ),
            winnerAccuracy: ROUND(
              metrics.marginResidualHybrid_sensitivity.winnerAccuracy -
                metrics.rawProductionAA.winnerAccuracy
            ),
          }
        : null,
    },
    bootstrapCI_modelC_minus_rawAA: {
      pairedIid: bootIidC,
      weekClustered: bootWeekC,
      caution:
        "IID paired bootstrap resamples games independently and can understate SE if within-week outcomes correlate. Week-clustered resamples whole weeks.",
    },
    interpretationNote:
      "Primary comparison is vs rawProductionAA (deployed frozen forecasts). Model A is a separately fitted research ridge — not identical to raw A/A. Leading candidate is marginResidualHybrid.",
  };

  const bootIidH = bootstrapPairedMetricDeltas(holdoutRows, leadingHybrid, rawProductionAA, {
    nBoot,
    seed: seed + 1,
  });
  const bootWeekH = bootstrapWeekClusteredMetricDeltas(holdoutRows, leadingHybrid, rawProductionAA, {
    nBoot,
    seed: seed + 2,
  });
  const bootWeekR = residualHybrid
    ? bootstrapWeekClusteredMetricDeltas(holdoutRows, residualHybrid, rawProductionAA, {
        nBoot,
        seed: seed + 3,
      })
    : null;

  const q2 = {
    question:
      "Can CORE improve margin forecasting without damaging total forecasting (margin-only hybrid)?",
    leadingCandidate: describeCfbCoreMarginHybrid(),
    design: {
      leading: {
        variant: CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING,
        train: "Model C margin ridge on combined features (2025; baseline slots may be Elo)",
        apply:
          "hybridMargin = ModelC(A/A baseline features + CORE); hybridTotal = productionAaTotal",
        mismatchNote:
          "Apply-time baseline feature slots use production A/A, not Elo. Covariate shift remains on those two slots.",
      },
      residualSensitivity: {
        variant: CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL,
        train: "residual = actualMargin - trainBaselineMargin ~ ridge(CORE crosses)",
        apply: "hybridMargin = A/A margin + residual(CORE); total = A/A total",
        mismatchNote: "CORE-only residual; Elo never enters apply-time scoring.",
      },
    },
    metrics: {
      rawProductionAA: metrics.rawProductionAA,
      modelC_full: metrics.modelC_combined,
      leading_modelCMargin_aaTotal: metrics.marginOnlyHybrid_modelCMargin_aaTotal,
      residualSensitivity: metrics.marginResidualHybrid_sensitivity,
    },
    deltasVsRawAA_leading: {
      spreadMae: ROUND(
        metrics.marginOnlyHybrid_modelCMargin_aaTotal.spreadMae - metrics.rawProductionAA.spreadMae
      ),
      totalMae: ROUND(
        metrics.marginOnlyHybrid_modelCMargin_aaTotal.totalMae - metrics.rawProductionAA.totalMae
      ),
      winnerAccuracy: ROUND(
        metrics.marginOnlyHybrid_modelCMargin_aaTotal.winnerAccuracy -
          metrics.rawProductionAA.winnerAccuracy
      ),
    },
    deltasVsRawAA_residualSensitivity: metrics.marginResidualHybrid_sensitivity
      ? {
          spreadMae: ROUND(
            metrics.marginResidualHybrid_sensitivity.spreadMae - metrics.rawProductionAA.spreadMae
          ),
          totalMae: ROUND(
            metrics.marginResidualHybrid_sensitivity.totalMae - metrics.rawProductionAA.totalMae
          ),
          winnerAccuracy: ROUND(
            metrics.marginResidualHybrid_sensitivity.winnerAccuracy -
              metrics.rawProductionAA.winnerAccuracy
          ),
        }
      : null,
    bootstrapCI_leading_minus_rawAA: {
      pairedIid: bootIidH,
      weekClustered: bootWeekH,
    },
    bootstrapCI_residual_minus_rawAA: { weekClustered: bootWeekR },
    consistencyCheck: {
      residualTotalExactlyMatchesRawAA: residualHybrid
        ? residualHybrid.every((p, i) => Math.abs(p.total - rawProductionAA[i].total) < 1e-9)
        : false,
      legacyTotalExactlyMatchesRawAA: leadingHybrid.every(
        (p, i) => Math.abs(p.total - rawProductionAA[i].total) < 1e-9
      ),
      caution:
        "Unchanged total MAE is guaranteed by construction for both hybrids — it is not evidence of an improved totals model. The meaningful claim is the margin MAE reduction.",
    },
    leadingArtifact: leadingArtifact.ok
      ? {
          ok: true,
          variant: leadingArtifact.variant,
          trainN: leadingArtifact.trainN,
          lambda: leadingArtifact.margin.lambda,
          features: leadingArtifact.features,
          lastTrainingSeason: leadingArtifact.lastTrainingSeason,
        }
      : leadingArtifact,
    residualArtifact: residualArtifact.ok
      ? {
          ok: true,
          variant: residualArtifact.variant,
          trainN: residualArtifact.trainN,
          lambda: residualArtifact.residual.lambda,
          features: residualArtifact.features,
          lastTrainingSeason: residualArtifact.lastTrainingSeason,
        }
      : residualArtifact,
  };

  const leadingPreds = leadingHybrid;
  const q3 = {
    question: "Are margin improvements stable across slices?",
    vsRawAA: {
      byWeek: sliceHoldoutMetrics(holdoutRows, modelC, rawProductionAA, { by: "week" }),
      byConference: sliceHoldoutMetrics(holdoutRows, modelC, rawProductionAA, {
        by: "conference",
      }),
      byFavoriteUnderdog: sliceHoldoutMetrics(holdoutRows, modelC, rawProductionAA, {
        by: "favorite_underdog",
      }),
      byMatchupType: sliceHoldoutMetrics(holdoutRows, modelC, rawProductionAA, {
        by: "matchup_type",
      }),
    },
    vsRawAA_leadingHybrid: {
      byWeek: sliceHoldoutMetrics(holdoutRows, leadingPreds, rawProductionAA, { by: "week" }),
      byMatchupType: sliceHoldoutMetrics(holdoutRows, leadingPreds, rawProductionAA, {
        by: "matchup_type",
      }),
      byFavoriteUnderdog: sliceHoldoutMetrics(holdoutRows, leadingPreds, rawProductionAA, {
        by: "favorite_underdog",
      }),
    },
    // Keep prior key for script compatibility
    vsRawAA_marginOnlyHybrid: {
      byWeek: sliceHoldoutMetrics(holdoutRows, leadingPreds, rawProductionAA, { by: "week" }),
      byMatchupType: sliceHoldoutMetrics(holdoutRows, leadingPreds, rawProductionAA, {
        by: "matchup_type",
      }),
      byFavoriteUnderdog: sliceHoldoutMetrics(holdoutRows, leadingPreds, rawProductionAA, {
        by: "favorite_underdog",
      }),
    },
    concentration_modelC_vs_rawAA: marginImprovementConcentration(
      holdoutRows,
      modelC,
      rawProductionAA,
      { topN: 10 }
    ),
    concentration_hybrid_vs_rawAA: marginImprovementConcentration(
      holdoutRows,
      leadingPreds,
      rawProductionAA,
      { topN: 10 }
    ),
  };

  const promotionProbe = evaluateMarginHybridPromotion({
    historicalHoldoutN: holdoutRows.length,
    prospectiveOosN: 0, // not yet accumulated
    marginMaeImprovement:
      metrics.rawProductionAA.spreadMae - metrics.marginOnlyHybrid_modelCMargin_aaTotal.spreadMae,
    totalMaeRegression:
      metrics.marginOnlyHybrid_modelCMargin_aaTotal.totalMae - metrics.rawProductionAA.totalMae,
    winnerAccuracyRegression:
      metrics.rawProductionAA.winnerAccuracy -
      metrics.marginOnlyHybrid_modelCMargin_aaTotal.winnerAccuracy,
    marginBiasAbs: null,
    marginMaeCiExcludesZero: bootWeekH?.spreadMaeDelta?.ciExcludesZero === true,
    weekClusteredBootstrap: true,
    prospectiveFrozenNoRetune: false,
    trainEvalBaselineMismatchDocumented: true,
    noHoldoutRetune: true,
    operatorApproved: false,
  });

  return {
    researchOnly: true,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
    counts: { train2025: trainRows.length, holdout2026: holdoutRows.length },
    lambdas: { ...fitted.lambdas, lambdaResidual },
    metrics,
    q1_vs_raw_production_aa: q1,
    q2_margin_only_hybrid: q2,
    q3_stability_slices: q3,
    promotionGateProbe: promotionProbe,
    bootstrapValidation: {
      iidResamplesGamesIndependently: true,
      weekClusteredResamplesEntireWeeks: true,
      withinWeekCorrelationAccountedIn: "week_clustered",
      recommendation: "Prefer week-clustered CI for promotion decisions; report both.",
    },
  };
}
