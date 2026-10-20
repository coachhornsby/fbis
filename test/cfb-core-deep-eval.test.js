import test from "node:test";
import assert from "node:assert/strict";
import {
  scoresFromMarginTotal,
  rawProductionAaPredictions,
  metricsAgainstActuals,
  bootstrapPairedMetricDeltas,
  answerDeepEvalQuestions,
  classifyMatchupType,
  marginImprovementConcentration,
} from "../functions/lib/cfbCoreDeepEval.js";

test("scoresFromMarginTotal reconstructs home/away consistently", () => {
  const s = scoresFromMarginTotal(10, 50);
  assert.equal(s.home, 30);
  assert.equal(s.away, 20);
  assert.equal(s.home - s.away, 10);
  assert.equal(s.home + s.away, 50);
});

test("rawProductionAaPredictions uses baseline scores as-is", () => {
  const rows = [{ baselineHome: 31.2, baselineAway: 24.8, actualMargin: 7, actualTotal: 56 }];
  const preds = rawProductionAaPredictions(rows);
  assert.ok(Math.abs(preds[0].margin - 6.4) < 1e-9);
  assert.equal(preds[0].total, 56);
  assert.equal(preds[0].source, "raw_production_aa_frozen");
});

test("metricsAgainstActuals reports MAE and winner accuracy", () => {
  const rows = [
    { actualMargin: 10, actualTotal: 50, actualHome: 30, actualAway: 20 },
    { actualMargin: -7, actualTotal: 41, actualHome: 17, actualAway: 24 },
  ];
  const preds = [
    { margin: 8, total: 48, home: 28, away: 20 },
    { margin: -3, total: 40, home: 18.5, away: 21.5 },
  ];
  const m = metricsAgainstActuals(rows, preds);
  assert.equal(m.n, 2);
  assert.equal(m.winnerAccuracy, 1);
  assert.ok(m.spreadMae > 0);
  assert.ok(m.totalMae > 0);
});

test("bootstrapPairedMetricDeltas returns CI envelopes", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    actualMargin: (i % 5) - 2,
    actualTotal: 50 + (i % 7),
    actualHome: 25 + ((i % 5) - 2) / 2,
    actualAway: 25 - ((i % 5) - 2) / 2,
  }));
  const challenger = rows.map((r) => ({
    margin: r.actualMargin + 0.5,
    total: r.actualTotal + 1,
    home: r.actualHome,
    away: r.actualAway,
  }));
  const champion = rows.map((r) => ({
    margin: r.actualMargin + 2,
    total: r.actualTotal + 2,
    home: r.actualHome,
    away: r.actualAway,
  }));
  const ci = bootstrapPairedMetricDeltas(rows, challenger, champion, { nBoot: 200, seed: 7 });
  assert.ok(ci.spreadMaeDelta);
  assert.ok(Number.isFinite(ci.spreadMaeDelta.ciLow));
  assert.ok(Number.isFinite(ci.spreadMaeDelta.ciHigh));
  assert.ok(ci.spreadMaeDelta.ciLow <= ci.spreadMaeDelta.ciHigh);
});

test("classifyMatchupType and concentration helpers", () => {
  assert.equal(
    classifyMatchupType({ homeConference: "SEC", awayConference: "SEC", neutralSite: false }),
    "intra_conference"
  );
  assert.equal(
    classifyMatchupType({ homeConference: "SEC", awayConference: "Big Ten", neutralSite: false }),
    "inter_conference"
  );
  const rows = [
    { gameId: "1", week: 5, homeTeam: "A", awayTeam: "B", actualMargin: 10 },
    { gameId: "2", week: 5, homeTeam: "C", awayTeam: "D", actualMargin: -3 },
  ];
  const c = [
    { margin: 9, total: 50, home: 29.5, away: 20.5 },
    { margin: 0, total: 40, home: 20, away: 20 },
  ];
  const a = [
    { margin: 0, total: 50, home: 25, away: 25 },
    { margin: -3, total: 40, home: 18.5, away: 21.5 },
  ];
  const conc = marginImprovementConcentration(rows, c, a, { topN: 1 });
  assert.equal(conc.nImproved + conc.nWorsened + conc.nTied, 2);
  assert.equal(conc.topImprovers.length, 1);
});

test("answerDeepEvalQuestions distinguishes raw AA from model A/C", () => {
  const mk = (i, season) => {
    const bh = 28 + (i % 5);
    const ba = 24 - (i % 3);
    const am = ((i % 7) - 3) * 3;
    const at = 50 + (i % 9);
    return {
      gameId: `${season}-${i}`,
      season,
      week: 5 + (i % 4),
      homeTeam: "Home",
      awayTeam: "Away",
      homeConference: i % 2 ? "SEC" : "Big Ten",
      awayConference: i % 3 ? "SEC" : "ACC",
      neutralSite: false,
      baselineHome: bh,
      baselineAway: ba,
      actualHome: (at + am) / 2,
      actualAway: (at - am) / 2,
      actualMargin: am,
      actualTotal: at,
      xChampion: [bh - ba, bh + ba],
      xCombined: [bh - ba, bh + ba, (i % 5) - 2, (i % 4) - 1],
    };
  };
  const train = Array.from({ length: 80 }, (_, i) => mk(i, 2025));
  const holdout = Array.from({ length: 40 }, (_, i) => mk(i + 100, 2026));
  const report = answerDeepEvalQuestions({
    trainRows: train,
    holdoutRows: holdout,
    nBoot: 100,
    seed: 1,
  });
  assert.equal(report.counts.holdout2026, 40);
  assert.ok(report.q1_vs_raw_production_aa.benchmarks.rawProductionAA);
  assert.ok(report.q1_vs_raw_production_aa.bootstrapCI_modelC_minus_rawAA.pairedIid.spreadMaeDelta);
  assert.ok(report.q1_vs_raw_production_aa.bootstrapCI_modelC_minus_rawAA.weekClustered.spreadMaeDelta);
  assert.equal(report.q2_margin_only_hybrid.consistencyCheck.legacyTotalExactlyMatchesRawAA, true);
  assert.ok(report.q3_stability_slices.vsRawAA.byWeek.length >= 1);
  assert.equal(report.canInfluenceProduction, false);
  assert.equal(report.promotionGateProbe.promote, false);
});
