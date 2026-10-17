import test from "node:test";
import assert from "node:assert/strict";
import { parseCfbTier3WeeklyCsv } from "../functions/lib/cfbTier3Weekly.js";
import {
  homeAtsResult,
  favoriteSide,
  researchPredictedMargin,
  evaluateCfbTier3Weekly,
  compareWeekSummaries,
  pearson,
} from "../functions/lib/cfbTier3WeeklyEvaluation.js";

const featurePads = Array.from({ length: 8 }, (_, i) => `pad_feature_${i}`);
const cols = [
  "id","start_date","season","season_type","week","neutral_site","home_team",
  "home_conference","home_elo","home_talent","away_team","away_conference",
  "away_talent","away_elo","spread",
  "home_adjusted_epa","home_adjusted_epa_allowed","away_adjusted_epa","away_adjusted_epa_allowed",
  ...featurePads,
];
const row = (id, spread, extras = {}) => {
  const pads = Object.fromEntries(featurePads.map((k) => [k, "0.1"]));
  const base = {
    id, start_date: "2026-10-10 19:30:00", season: "2026", season_type: "regular", week: "6",
    neutral_site: "False", home_team: "Home U", home_conference: "X", home_elo: "1600",
    home_talent: "700", away_team: "Away U", away_conference: "X", away_talent: "650",
    away_elo: "1400", spread: String(spread),
    home_adjusted_epa: "0.2", home_adjusted_epa_allowed: "0.05",
    away_adjusted_epa: "0.05", away_adjusted_epa_allowed: "0.15",
    ...pads,
    ...extras,
  };
  return cols.map((c) => base[c]).join(",");
};
const csv = (rows) => cols.join(",") + "\n" + rows.join("\n") + "\n";

test("ATS and favorite helpers respect home-centric spread", () => {
  assert.equal(homeAtsResult(10, -7), "home"); // covered by 3
  assert.equal(homeAtsResult(7, -7), "push");
  assert.equal(homeAtsResult(3, -7), "away");
  assert.equal(favoriteSide(-7), "home");
  assert.equal(favoriteSide(3.5), "away");
  assert.equal(favoriteSide(0), "pick");
});

test("research predicted margin stays finite and research-only", () => {
  const m = researchPredictedMargin({
    home_elo: 1600, away_elo: 1400, home_talent: 700, away_talent: 650,
    home_adjusted_epa: 0.2, away_adjusted_epa: 0.05,
    home_adjusted_epa_allowed: 0.05, away_adjusted_epa_allowed: 0.15,
  });
  assert.ok(Number.isFinite(m.blendMargin));
  assert.ok(m.blendMargin > 0);
});

test("week evaluation grades ATS without authorizing wagers", async () => {
  const snap = await parseCfbTier3WeeklyCsv(csv([
    row("401866401", -7),
    row("401866402", 3.5, { home_team: "B", away_team: "C", home_elo: "1300", away_elo: "1500" }),
  ]));
  const finals = new Map([
    ["401866401", { homePoints: 31, awayPoints: 17, completed: true }],
    ["401866402", { homePoints: 14, awayPoints: 21, completed: true }],
  ]);
  const result = evaluateCfbTier3Weekly(snap, finals);
  assert.equal(result.canAuthorizeWager, false);
  assert.equal(result.authority, "research_only");
  assert.equal(result.summary.graded, 2);
  assert.equal(result.summary.canAuthorizeWager, false);
  assert.equal(result.games[0].ats, "home"); // 14 + (-7) > 0
  assert.equal(result.games[1].ats, "away"); // -7 + 3.5 < 0
  assert.ok(Number.isFinite(result.summary.correlations.marketImpliedVsMargin) ||
    result.summary.correlations.marketImpliedVsMargin === null);
  assert.equal(pearson([1, 2, 3], [1, 2, 3]), 1);
});

test("compareWeekSummaries keeps research-only flag", () => {
  const cmp = compareWeekSummaries([
    { week: 6, season: 2026, graded: 57, homeAtsRate: 0.56, favoriteSuRate: 0.7,
      naiveBlendAtsRate: 0.47, correlations: { marketImpliedVsMargin: 0.6, blendVsMargin: 0.5 },
      mae: { openingSpread: 11, naiveBlend: 12 }, edgeBuckets: [{ minAbsEdge: 7, n: 10, hitRate: 0.5 }] },
    { week: 7, season: 2026, graded: 50, homeAtsRate: 0.5, favoriteSuRate: 0.65,
      naiveBlendAtsRate: 0.48, correlations: { marketImpliedVsMargin: 0.55, blendVsMargin: 0.5 },
      mae: { openingSpread: 12, naiveBlend: 13 }, edgeBuckets: [{ minAbsEdge: 7, n: 8, hitRate: 0.4 }] },
  ]);
  assert.equal(cmp.canAuthorizeWager, false);
  assert.equal(cmp.weeks.length, 2);
});
