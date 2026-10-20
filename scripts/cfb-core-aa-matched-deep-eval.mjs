#!/usr/bin/env node
/**
 * Deep eval: weekly-report CORE vs raw frozen production A/A on matched cohort.
 *
 * Answers three operator questions:
 *   Q1 — beat raw A/A on spread/total/winner (+ bootstrap CIs)?
 *   Q2 — margin-only CORE hybrid keeping A/A totals fixed?
 *   Q3 — stability across week / conference / fav-dog / matchup type?
 *
 * Env (defaults match Cloud Agent artifact paths):
 *   CFB_HOLDOUT_GAMES, CFB_HOLDOUT_BASELINES, CFB_HOLDOUT_TIER3_2025/2026
 *   CFB_DEEP_EVAL_OUT — report path
 *   CFB_DEEP_EVAL_BOOT — bootstrap draws (default 2000)
 *
 * Research-only.
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
import { answerDeepEvalQuestions } from "../functions/lib/cfbCoreDeepEval.js";

const outPath = resolve(
  process.env.CFB_DEEP_EVAL_OUT ||
    "artifacts/cfb-core-aa-matched-deep-eval-report.json"
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
      finalVerified: true,
      baselineSource: b.baselineSource || "prediction_snapshots_aa_earliest_frozen",
      championModelId: b.championModelId || "CFB-FBIS-v2",
    };
  });
}

function main() {
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
  const nBoot = Number(process.env.CFB_DEEP_EVAL_BOOT || 2000);

  const reports = [
    ...loadWeeklyReportsFromDir(dir2025, CORE_HOLDOUT_TRAIN_SEASON),
    ...loadWeeklyReportsFromDir(dir2026, CORE_HOLDOUT_EVAL_SEASON),
  ];
  const reconstructed = reconstructFbisCoreFromWeeklyReports(reports);
  let games = loadJson(gamesPath) || [];
  const baselines = loadJson(baselinesPath) || [];
  games = attachBaselines(games, baselines);

  // Holdout: only 2026 games with production A/A. Train: 2025 with any baseline.
  const built = buildEligibleCoreHoldoutRows({
    games,
    archiveRows: reconstructed.archiveRows,
    requireChampionBaseline: true,
  });

  const trainRows = built.train;
  const holdoutRows = built.holdout.filter(
    (r) =>
      r.season === CORE_HOLDOUT_EVAL_SEASON &&
      Number.isFinite(r.baselineHome) &&
      Number.isFinite(r.baselineAway)
  );

  // Reuse λ selection from holdout design (2025 chronological only).
  const lambdaSelectC = selectLambdaWithinTrainSeason(trainRows, {
    featureMode: "combined",
  });
  const lambdaSelectA = selectLambdaWithinTrainSeason(trainRows, {
    featureMode: "champion",
  });
  const lambdaCombined = lambdaSelectC?.selectedLambda ?? 1;
  const lambdaChampion = lambdaSelectA?.selectedLambda ?? 1;

  const deep = answerDeepEvalQuestions({
    trainRows,
    holdoutRows,
    lambdaChampion,
    lambdaCombined,
    nBoot,
    seed: 42,
  });

  const report = {
    status: holdoutRows.length ? "DEEP_EVAL_COMPLETE" : "BLOCKED_EMPTY_HOLDOUT",
    blocked: holdoutRows.length === 0,
    generatedAt: new Date().toISOString(),
    researchOnly: true,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
    benchmarkDefinitions: {
      rawProductionAA:
        "Earliest-frozen graded CFB-FBIS-v2 prediction_snapshots proj_home/proj_away (deployed champion forecasts).",
      modelA:
        "Research ridge fitted on 2025 champion baseline features; NOT identical to raw production A/A.",
      modelC: "Research ridge fitted on 2025 CORE+baseline combined features.",
      marginOnlyHybrid:
        "Model C predicted margin + raw production A/A total; scores reconstructed as home=(T+M)/2, away=(T−M)/2.",
    },
    cohort: {
      train2025: trainRows.length,
      holdout2026: holdoutRows.length,
      holdoutBaselineSource: "prediction_snapshots_aa_earliest_frozen",
      trainBaselineSourceNote:
        "2025 train baselines may be Elo proxy — distribution mismatch risk called out in Q notes.",
      validationErrors: built.validationErrors,
      eligibleCounts: built.counts,
    },
    lambdaSelection: {
      champion: lambdaSelectA,
      combined: lambdaSelectC,
      used: { lambdaChampion, lambdaCombined },
    },
    reconstruction: {
      ok: reconstructed.ok,
      coverage: reconstructed.coverage,
      archiveRowCount: reconstructed.archiveRows.length,
    },
    ...deep,
  };

  // Compact operator summary
  const q1 = report.q1_vs_raw_production_aa;
  const q2 = report.q2_margin_only_hybrid;
  const conc = report.q3_stability_slices.concentration_hybrid_vs_rawAA;
  report.operatorSummary = {
    q1_beats_raw_aa: {
      spreadMaeDelta: q1.deltasVsRawAA.modelC.spreadMae,
      totalMaeDelta: q1.deltasVsRawAA.modelC.totalMae,
      winnerAccuracyDelta: q1.deltasVsRawAA.modelC.winnerAccuracy,
      spreadMaeCI: q1.bootstrapCI_modelC_minus_rawAA.spreadMaeDelta,
      totalMaeCI: q1.bootstrapCI_modelC_minus_rawAA.totalMaeDelta,
      winnerAccuracyCI: q1.bootstrapCI_modelC_minus_rawAA.winnerAccuracyDelta,
      clearsDualMaeBar:
        q1.deltasVsRawAA.modelC.spreadMae < 0 && q1.deltasVsRawAA.modelC.totalMae < 0,
    },
    q2_margin_only_hybrid: {
      spreadMaeDelta: q2.deltasVsRawAA.spreadMae,
      totalMaeDelta: q2.deltasVsRawAA.totalMae,
      winnerAccuracyDelta: q2.deltasVsRawAA.winnerAccuracy,
      spreadMaeCI: q2.bootstrapCI_hybrid_minus_rawAA.spreadMaeDelta,
      totalMaeCI: q2.bootstrapCI_hybrid_minus_rawAA.totalMaeDelta,
      winnerAccuracyCI: q2.bootstrapCI_hybrid_minus_rawAA.winnerAccuracyDelta,
      totalUnchangedVsRawAA: q2.consistencyCheck.totalExactlyMatchesRawAA,
      improvesMarginWithoutWorseningTotal:
        q2.deltasVsRawAA.spreadMae < 0 && q2.deltasVsRawAA.totalMae <= 0,
    },
    q3_stability: {
      nImproved: conc.nImproved,
      nWorsened: conc.nWorsened,
      top10ShareOfPositiveImprovement: conc.topNShareOfPositiveImprovement,
      byWeek: report.q3_stability_slices.vsRawAA_marginOnlyHybrid.byWeek.map((s) => ({
        slice: s.slice,
        n: s.n,
        spreadMaeDelta: s.delta.spreadMae,
        winnerAccuracyDelta: s.delta.winnerAccuracy,
      })),
    },
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  try {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/cfb-core-aa-matched-deep-eval-report.json",
      JSON.stringify(report, null, 2) + "\n"
    );
    writeFileSync(
      "/opt/cursor/artifacts/cfb-core-aa-matched-deep-eval-summary.json",
      JSON.stringify(
        {
          status: report.status,
          cohort: report.cohort,
          benchmarkDefinitions: report.benchmarkDefinitions,
          metrics: report.metrics,
          operatorSummary: report.operatorSummary,
          productionSafeguards: {
            researchOnly: true,
            canAuthorizeWager: false,
            canInfluenceProduction: false,
          },
        },
        null,
        2
      ) + "\n"
    );
  } catch (_) {}

  console.log(JSON.stringify(report.operatorSummary, null, 2));
  console.log("outPath", outPath);
  if (report.blocked) process.exitCode = 3;
}

main();
