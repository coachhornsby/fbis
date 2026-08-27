/**
 * Rolling-origin training for compact college artifacts.
 * Runs in GitHub Actions — never inside a Cloudflare Worker request.
 * Does not tune on FBIS-HC-v1 or operator tickets. Market lines are not features.
 */
import { writeFileSync } from "node:fs";
import { cfbRatingsV1, cfbLeagueBaseline, cfbRegV1 } from "../functions/lib/cfbRatings.js";
import { cbbRatingsV1, cbbLeagueBaseline } from "../functions/lib/cbbRatings.js";
import { mae, rmse, bias } from "../functions/lib/metrics.js";
import { evaluatePromotion } from "../functions/lib/collegeModels.js";

const CFB_FIXTURES = [
  { date: "2024-09-07", homeOff: 38, homeDef: 20, awayOff: 24, awayDef: 30, actualHome: 35, actualAway: 17, neutral: false },
  { date: "2024-10-12", homeOff: 32, homeDef: 22, awayOff: 33, awayDef: 21, actualHome: 28, actualAway: 31, neutral: false },
  { date: "2024-11-23", homeOff: 41, homeDef: 16, awayOff: 19, awayDef: 34, actualHome: 45, actualAway: 14, neutral: false },
  { date: "2025-01-01", homeOff: 36, homeDef: 18, awayOff: 34, awayDef: 19, actualHome: 34, actualAway: 31, neutral: true },
  { date: "2025-09-06", homeOff: 29, homeDef: 24, awayOff: 27, awayDef: 25, actualHome: 24, actualAway: 21, neutral: false },
];

const CBB_FIXTURES = [
  { date: "2025-01-15", homeAdjOe: 118, homeAdjDe: 92, homeTempo: 70, awayAdjOe: 104, awayAdjDe: 110, awayTempo: 66, actualHome: 82, actualAway: 71, neutral: false },
  { date: "2025-02-10", homeAdjOe: 110, homeAdjDe: 100, homeTempo: 67, awayAdjOe: 111, awayAdjDe: 99, awayTempo: 68, actualHome: 74, actualAway: 76, neutral: false },
  { date: "2025-03-21", homeAdjOe: 120, homeAdjDe: 90, homeTempo: 69, awayAdjOe: 108, awayAdjDe: 104, awayTempo: 64, actualHome: 78, actualAway: 65, neutral: true },
];

function rolling(rows, predictFn) {
  const folds = [];
  for (let i = 2; i < rows.length; i++) {
    const train = rows.slice(0, i);
    const val = rows.slice(i, i + 1);
    const preds = val.map((g) => ({ ...predictFn(g), actualHome: g.actualHome, actualAway: g.actualAway }));
    folds.push({ trainUntil: train.at(-1).date, n: preds.length, preds });
  }
  const all = folds.flatMap((f) => f.preds);
  const errTotal = all.map((p) => p.home + p.away - (p.actualHome + p.actualAway));
  const errMargin = all.map((p) => p.home - p.away - (p.actualHome - p.actualAway));
  return {
    method: "rolling-origin",
    n: all.length,
    maeTotal: mae(errTotal),
    rmseTotal: rmse(errTotal),
    biasTotal: bias(errTotal),
    maeMargin: mae(errMargin),
    folds: folds.map((f) => ({ trainUntil: f.trainUntil, n: f.n })),
  };
}

function cfbPredict(g) {
  return cfbRatingsV1({ neutralSite: g.neutral }, { homeOff: g.homeOff, homeDef: g.homeDef, awayOff: g.awayOff, awayDef: g.awayDef });
}

function cbbPredict(g) {
  return cbbRatingsV1({ neutralSite: g.neutral }, g);
}

const cfb = {
  league: rolling(CFB_FIXTURES, (g) => cfbLeagueBaseline({ neutralSite: g.neutral })),
  ratings: rolling(CFB_FIXTURES, cfbPredict),
  reg: rolling(CFB_FIXTURES, (g) => cfbRegV1({ neutralSite: g.neutral }, { home_off: g.homeOff, home_def: g.homeDef, away_off: g.awayOff, away_def: g.awayDef })),
};
const cbb = {
  league: rolling(CBB_FIXTURES, (g) => cbbLeagueBaseline({ neutralSite: g.neutral })),
  ratings: rolling(CBB_FIXTURES, cbbPredict),
};

const report = {
  generatedAt: new Date().toISOString(),
  leakage: "Features are fixture as-of ratings; no future season totals used as Week 1 priors.",
  cfb,
  cbb,
  promotion: evaluatePromotion({ n: cfb.ratings.n, maeImproved: false, operatorApproved: false }),
};

if (process.argv.includes("--write")) {
  writeFileSync(new URL("../data/models/validation-report.json", import.meta.url), JSON.stringify(report, null, 2));
}

console.log(JSON.stringify({ ok: true, cfbN: cfb.ratings.n, cbbN: cbb.ratings.n, promote: report.promotion.promote }, null, 2));
