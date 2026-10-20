import test from "node:test";
import assert from "node:assert/strict";
import {
  fitMarginResidualArtifact,
  projectCfbCoreMarginHybrid,
  evaluateMarginHybridPromotion,
  describeCfbCoreMarginHybrid,
  fitModelCMarginAaTotalArtifact,
  CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING,
  CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL,
  scoresFromMarginTotal,
} from "../functions/lib/cfbCoreMarginHybrid.js";
import {
  bootstrapPairedMetricDeltas,
  bootstrapWeekClusteredMetricDeltas,
  bootstrapReplicateDelta,
  metricsAgainstActuals,
} from "../functions/lib/cfbCoreDeepEval.js";

function mkRow(i, season) {
  const bh = 28 + (i % 5);
  const ba = 24 - (i % 3);
  const am = ((i % 7) - 3) * 4;
  const at = 52 + (i % 9);
  const coreM = ((i % 5) - 2) * 3;
  const coreT = (i % 4) - 1;
  return {
    gameId: `${season}-${i}`,
    season,
    week: 5 + (i % 3),
    baselineHome: bh,
    baselineAway: ba,
    actualHome: (at + am) / 2,
    actualAway: (at - am) / 2,
    actualMargin: am,
    actualTotal: at,
    xCombined: [bh - ba, bh + ba, coreM, coreT],
    vector: {
      features: {
        baselineMargin: bh - ba,
        baselineTotal: bh + ba,
        coreCrossMargin: coreM,
        coreCrossTotal: coreT,
      },
    },
  };
}

test("describeCfbCoreMarginHybrid flags construction caution", () => {
  const d = describeCfbCoreMarginHybrid();
  assert.equal(d.totalMaeUnchangedByConstruction, true);
  assert.equal(d.leadingResearchCandidate, true);
  assert.equal(d.canInfluenceProduction, false);
});

test("leading Model C margin hybrid preserves A/A total", () => {
  const train = Array.from({ length: 90 }, (_, i) => mkRow(i, 2025));
  const art = fitModelCMarginAaTotalArtifact(train, { lambda: 1, lastTrainingSeason: 2025 });
  assert.equal(art.ok, true);
  assert.equal(art.variant, CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING);
  const row = mkRow(200, 2026);
  const p = projectCfbCoreMarginHybrid(row, art);
  assert.equal(p.ok, true);
  assert.ok(Math.abs(p.total - (row.baselineHome + row.baselineAway)) < 1e-9);
  const s = scoresFromMarginTotal(p.margin, p.total);
  assert.ok(Math.abs(s.home - p.home) < 1e-9);
});

test("residual hybrid preserves A/A total and adds CORE residual", () => {
  const train = Array.from({ length: 90 }, (_, i) => mkRow(i, 2025));
  const art = fitMarginResidualArtifact(train, { lambda: 1, lastTrainingSeason: 2025 });
  assert.equal(art.ok, true);
  assert.equal(art.variant, CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL);
  const row = mkRow(200, 2026);
  const p = projectCfbCoreMarginHybrid(row, art);
  assert.equal(p.ok, true);
  assert.ok(Math.abs(p.total - (row.baselineHome + row.baselineAway)) < 1e-9);
  assert.ok(Math.abs(p.margin - (p.aaMargin + p.residual)) < 1e-9);
});

test("promotion gate rejects missing prospective sample and requires week-clustered CI", () => {
  const rejected = evaluateMarginHybridPromotion({
    historicalHoldoutN: 149,
    prospectiveOosN: 10,
    marginMaeImprovement: 0.5,
    totalMaeRegression: 0,
    winnerAccuracyRegression: -0.01,
    marginBiasAbs: 0.2,
    marginMaeCiExcludesZero: true,
    weekClusteredBootstrap: true,
    prospectiveFrozenNoRetune: true,
    trainEvalBaselineMismatchDocumented: true,
    noHoldoutRetune: true,
    operatorApproved: false,
  });
  assert.equal(rejected.promote, false);
  assert.ok(rejected.fail.includes("prospective-oos-n 10 < 200"));
  assert.ok(rejected.fail.includes("operator-approval-required"));
  assert.match(rejected.caution, /construction/i);
});

test("bootstrap: IID vs week-clustered and independent replicate audit", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    week: 5 + (i % 3),
    actualMargin: (i % 5) - 2,
    actualTotal: 50 + (i % 7),
    actualHome: 25,
    actualAway: 25,
  }));
  const challenger = rows.map((r, i) => ({
    margin: r.actualMargin + (i % 2 ? 0.5 : -0.2),
    total: r.actualTotal,
    home: 25,
    away: 25,
  }));
  const champion = rows.map((r) => ({
    margin: r.actualMargin + 2,
    total: r.actualTotal,
    home: 25,
    away: 25,
  }));

  const iid = bootstrapPairedMetricDeltas(rows, challenger, champion, { nBoot: 300, seed: 9 });
  const week = bootstrapWeekClusteredMetricDeltas(rows, challenger, champion, {
    nBoot: 300,
    seed: 9,
  });
  assert.equal(iid.spreadMaeDelta.method, "paired_iid_games");
  assert.equal(week.spreadMaeDelta.method, "week_clustered");
  assert.equal(week.spreadMaeDelta.nClusters, 3);
  assert.ok(iid.spreadMaeDelta.ciLow <= iid.spreadMaeDelta.ciHigh);

  // Independent replicate: same indices → same delta as metrics path
  const idx = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45];
  const rep = bootstrapReplicateDelta(rows, challenger, champion, idx);
  const mC = metricsAgainstActuals(
    idx.map((i) => rows[i]),
    idx.map((i) => challenger[i])
  );
  const mA = metricsAgainstActuals(
    idx.map((i) => rows[i]),
    idx.map((i) => champion[i])
  );
  assert.equal(rep.spreadMae, Number((mC.spreadMae - mA.spreadMae).toFixed(4)));
  assert.equal(rep.n, idx.length);
});
