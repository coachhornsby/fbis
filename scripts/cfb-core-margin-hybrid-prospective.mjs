#!/usr/bin/env node
/**
 * Freeze margin-only CORE hybrid artifact from 2025 train ONLY, then
 * (a) score the locked 2026 historical holdout without retuning, and
 * (b) emit prospective shadow predictions for any pregame rows supplied.
 *
 * Never refits on the 149-game holdout. Research-only.
 *
 * Env:
 *   CFB_HOLDOUT_GAMES / CFB_HOLDOUT_BASELINES / CFB_HOLDOUT_TIER3_2025/2026
 *   CFB_PROSPECTIVE_GAMES — optional JSON of upcoming games with A/A baselines
 *   CFB_MARGIN_HYBRID_OUT — report directory
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import {
  reconstructFbisCoreFromWeeklyReports,
  parseWeeklyTrainingReportCsv,
} from "../functions/lib/cfbCoreFromWeeklyReports.js";
import {
  buildEligibleCoreHoldoutRows,
  selectLambdaWithinTrainSeason,
  CORE_HOLDOUT_TRAIN_SEASON,
  CORE_HOLDOUT_EVAL_SEASON,
} from "../functions/lib/cfbCoreHoldout.js";
import {
  fitModelCMarginAaTotalArtifact,
  fitMarginResidualArtifact,
  projectCfbCoreMarginHybrid,
  marginHybridPredictionsForRows,
  describeCfbCoreMarginHybrid,
  evaluateMarginHybridPromotion,
  CFB_CORE_MARGIN_HYBRID_ID,
  CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING,
  CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL,
} from "../functions/lib/cfbCoreMarginHybrid.js";
import {
  metricsAgainstActuals,
  rawProductionAaPredictions,
  bootstrapPairedMetricDeltas,
  bootstrapWeekClusteredMetricDeltas,
} from "../functions/lib/cfbCoreDeepEval.js";

const outDir = resolve(
  process.env.CFB_MARGIN_HYBRID_OUT || "/opt/cursor/artifacts/margin-hybrid"
);

function loadJson(path) {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadWeeklyReportsFromDir(dir, defaultSeason) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.csv$/i.test(f))
    .sort()
    .map((f) => {
      const m = f.match(/week[_-]?(\d{1,2})/i);
      const week = m ? Number(m[1]) : null;
      const seasonMatch = f.match(/(20\d{2})/);
      const season = seasonMatch ? Number(seasonMatch[1]) : defaultSeason;
      const text = readFileSync(join(dir, f), "utf8");
      const parsed = parseWeeklyTrainingReportCsv(text, {
        defaultSeason: season,
        defaultWeek: week,
      });
      return {
        season: season ?? parsed.season,
        week: week ?? parsed.scheduleWeek,
        text,
        rows: parsed.rows,
        filename: f,
      };
    });
}

function attachBaselines(games, baselines) {
  const byId = new Map((baselines || []).map((b) => [String(b.gameId), b]));
  return games.map((g) => {
    const b = byId.get(String(g.gameId));
    if (!b) return g;
    return {
      ...g,
      baselineHome: b.baselineHome ?? g.baselineHome,
      baselineAway: b.baselineAway ?? g.baselineAway,
      actualHome: b.actualHome ?? g.actualHome,
      actualAway: b.actualAway ?? g.actualAway,
      finalVerified: g.finalVerified ?? true,
      baselineSource: b.baselineSource || g.baselineSource,
      championModelId: b.championModelId || "CFB-FBIS-v2",
    };
  });
}

function main() {
  mkdirSync(outDir, { recursive: true });
  const design = describeCfbCoreMarginHybrid();
  const dir2025 =
    process.env.CFB_HOLDOUT_TIER3_2025 || "/opt/cursor/artifacts/tier3-csv-2025";
  const dir2026 =
    process.env.CFB_HOLDOUT_TIER3_2026 || "/opt/cursor/artifacts/tier3-csv-2026";
  const gamesPath =
    process.env.CFB_HOLDOUT_GAMES ||
    "/opt/cursor/artifacts/holdout-inputs/games-aa-strict-cohort.json";
  const baselinesPath =
    process.env.CFB_HOLDOUT_BASELINES ||
    "/opt/cursor/artifacts/holdout-inputs/baselines-aa-frozen.json";
  const prospectivePath = process.env.CFB_PROSPECTIVE_GAMES || null;
  const nBoot = Number(process.env.CFB_DEEP_EVAL_BOOT || 2000);

  const reports = [
    ...loadWeeklyReportsFromDir(dir2025, CORE_HOLDOUT_TRAIN_SEASON),
    ...loadWeeklyReportsFromDir(dir2026, CORE_HOLDOUT_EVAL_SEASON),
  ];
  const reconstructed = reconstructFbisCoreFromWeeklyReports(reports);
  let games = attachBaselines(loadJson(gamesPath) || [], loadJson(baselinesPath) || []);

  const built = buildEligibleCoreHoldoutRows({
    games,
    archiveRows: reconstructed.archiveRows,
    requireChampionBaseline: true,
  });
  const trainRows = built.train;
  const holdoutRows = built.holdout;

  // λ from 2025 chronological only — never from holdout.
  const lambdaSelect = selectLambdaWithinTrainSeason(trainRows, { featureMode: "combined" });
  const lambda = lambdaSelect?.selectedLambda ?? 1;

  // Leading empirical artifact (Model C margin + A/A total)
  const artifact = fitModelCMarginAaTotalArtifact(trainRows, {
    lambda,
    lastTrainingSeason: CORE_HOLDOUT_TRAIN_SEASON,
  });
  if (!artifact.ok) {
    console.error(JSON.stringify(artifact, null, 2));
    process.exit(2);
  }
  artifact.artifactId = `margin-hybrid-leading-2025-frozen-${Date.now()}`;
  artifact.frozenAt = new Date().toISOString();
  artifact.noHoldoutRetune = true;
  artifact.trainBaselineNote =
    "2025 train baseline feature slots may be Elo-proxy; apply-time slots MUST be production A/A. Totals always from A/A.";

  // Mismatch-robust residual sensitivity (not the promotion leader)
  const residualArtifact = fitMarginResidualArtifact(trainRows, {
    lambda,
    lastTrainingSeason: CORE_HOLDOUT_TRAIN_SEASON,
  });
  if (residualArtifact.ok) {
    residualArtifact.artifactId = `margin-hybrid-residual-2025-frozen-${Date.now()}`;
    residualArtifact.frozenAt = artifact.frozenAt;
    residualArtifact.noHoldoutRetune = true;
  }

  // Historical holdout score — frozen artifact, no retune
  const hybridPreds = marginHybridPredictionsForRows(holdoutRows, artifact);
  const rawAA = rawProductionAaPredictions(holdoutRows);
  const hybridMetrics = metricsAgainstActuals(holdoutRows, hybridPreds);
  const aaMetrics = metricsAgainstActuals(holdoutRows, rawAA);
  const bootIid = bootstrapPairedMetricDeltas(holdoutRows, hybridPreds, rawAA, {
    nBoot,
    seed: 42,
  });
  const bootWeek = bootstrapWeekClusteredMetricDeltas(holdoutRows, hybridPreds, rawAA, {
    nBoot,
    seed: 43,
  });

  // Prospective: upcoming games (if provided) — predictions only, no labels used for fit
  const prospectiveGames = loadJson(prospectivePath) || [];
  const prospectiveBuilt = prospectiveGames.length
    ? buildEligibleCoreHoldoutRows({
        games: prospectiveGames,
        archiveRows: reconstructed.archiveRows,
        requireChampionBaseline: true,
      })
    : { eligible: [] };
  const prospectivePreds = [];
  for (const row of prospectiveBuilt.eligible || []) {
    const p = projectCfbCoreMarginHybrid(row, artifact);
    prospectivePreds.push({
      gameId: row.gameId,
      season: row.season,
      week: row.week,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      kickoff: row.kickoff,
      aaHome: row.baselineHome,
      aaAway: row.baselineAway,
      prediction: p,
      frozenArtifactId: artifact.artifactId,
      authority: "research_only",
      canAuthorizeWager: false,
    });
  }

  const promotion = evaluateMarginHybridPromotion({
    historicalHoldoutN: holdoutRows.length,
    prospectiveOosN: 0,
    marginMaeImprovement: aaMetrics.spreadMae - hybridMetrics.spreadMae,
    totalMaeRegression: hybridMetrics.totalMae - aaMetrics.totalMae,
    winnerAccuracyRegression: aaMetrics.winnerAccuracy - hybridMetrics.winnerAccuracy,
    marginBiasAbs: null,
    marginMaeCiExcludesZero: bootWeek.spreadMaeDelta?.ciExcludesZero === true,
    weekClusteredBootstrap: true,
    prospectiveFrozenNoRetune: true,
    trainEvalBaselineMismatchDocumented: true,
    noHoldoutRetune: true,
    operatorApproved: false,
  });

  const report = {
    status: "MARGIN_HYBRID_ARTIFACT_FROZEN",
    generatedAt: new Date().toISOString(),
    design,
    modelId: CFB_CORE_MARGIN_HYBRID_ID,
    artifact: {
      artifactId: artifact.artifactId,
      version: artifact.version,
      variant: artifact.variant,
      lastTrainingSeason: artifact.lastTrainingSeason,
      features: artifact.features,
      residual: artifact.residual,
      trainN: artifact.trainN,
      frozenAt: artifact.frozenAt,
      noHoldoutRetune: true,
      verifiedOos: true,
      authority: "research_only",
    },
    lambdaSelectionWithin2025: lambdaSelect,
    historicalHoldout: {
      n: holdoutRows.length,
      rawProductionAA: aaMetrics,
      marginResidualHybrid: hybridMetrics,
      deltas: {
        spreadMae: Number((hybridMetrics.spreadMae - aaMetrics.spreadMae).toFixed(4)),
        totalMae: Number((hybridMetrics.totalMae - aaMetrics.totalMae).toFixed(4)),
        winnerAccuracy: Number(
          (hybridMetrics.winnerAccuracy - aaMetrics.winnerAccuracy).toFixed(4)
        ),
      },
      bootstrap: { pairedIid: bootIid, weekClustered: bootWeek },
      caution:
        "Total MAE delta is ~0 by construction. Do not cite total parity as a totals-model win.",
    },
    prospectiveShadow: {
      n: prospectivePreds.length,
      note: prospectivePreds.length
        ? "Frozen artifact applied to prospective slate; compare later to same A/A snapshots after settle."
        : "No CFB_PROSPECTIVE_GAMES supplied — artifact frozen for future shadow freezes.",
      predictions: prospectivePreds,
    },
    trainEvalBaselineMismatch: {
      train2025Baseline: "elo_proxy_from_weekly_report (when production A/A absent)",
      holdout2026Baseline: "prediction_snapshots CFB-FBIS-v2 earliest frozen",
      mitigation:
        "Residual features are CORE-only; apply-time margin = production A/A margin + residual.",
      documented: true,
    },
    promotionGate: promotion,
    productionSafeguards: {
      researchOnly: true,
      canAuthorizeWager: false,
      canInfluenceProduction: false,
      autoPromote: false,
      championAAUnchanged: true,
    },
  };

  report.residualSensitivityArtifact = residualArtifact.ok
    ? {
        artifactId: residualArtifact.artifactId,
        variant: CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL,
        trainN: residualArtifact.trainN,
        note: "Mismatch-robust CORE-only residual; historically weaker than leading on n=149.",
      }
    : residualArtifact;
  report.leadingVariant = CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING;

  writeFileSync(join(outDir, "artifact.json"), JSON.stringify(artifact, null, 2) + "\n");
  if (residualArtifact.ok) {
    writeFileSync(
      join(outDir, "artifact-residual-sensitivity.json"),
      JSON.stringify(residualArtifact, null, 2) + "\n"
    );
  }
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(
    join(outDir, "summary.json"),
    JSON.stringify(
      {
        status: report.status,
        artifactId: artifact.artifactId,
        historicalHoldout: report.historicalHoldout,
        promotionGate: {
          decision: promotion.decision,
          fail: promotion.fail,
          caution: promotion.caution,
        },
        prospectiveN: prospectivePreds.length,
        design,
      },
      null,
      2
    ) + "\n"
  );
  try {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/cfb-core-margin-hybrid-summary.json",
      JSON.stringify(
        {
          status: report.status,
          artifactId: artifact.artifactId,
          historicalHoldout: report.historicalHoldout,
          promotionGate: report.promotionGate,
          trainEvalBaselineMismatch: report.trainEvalBaselineMismatch,
          bootstrapValidation: {
            iid: bootIid.spreadMaeDelta,
            weekClustered: bootWeek.spreadMaeDelta,
          },
        },
        null,
        2
      ) + "\n"
    );
  } catch (_) {}

  console.log(
    JSON.stringify(
      {
        artifactId: artifact.artifactId,
        holdoutN: holdoutRows.length,
        spreadMaeDelta: report.historicalHoldout.deltas.spreadMae,
        totalMaeDelta: report.historicalHoldout.deltas.totalMae,
        weekClusteredSpreadCI: bootWeek.spreadMaeDelta,
        promotionDecision: promotion.decision,
        promotionFail: promotion.fail,
        outDir,
      },
      null,
      2
    )
  );
}

main();
