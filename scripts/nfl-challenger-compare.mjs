#!/usr/bin/env node
/**
 * Independent challenger comparison on identical chronological windows.
 * Reads artifacts/nfl-pro-v1-2/report.json from nfl-pro-v1-1-walkforward.py.
 * Research only — never promotes a champion or expands wager authority.
 *
 * Enforces market-relative promotion gate: identical-window OOS must beat
 * closing market; CLV economics + operator approval still required.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPORT = process.env.WALKFORWARD_REPORT || "artifacts/nfl-pro-v1-2/report.json";
const OUT = process.env.ARTIFACT_DIR || "artifacts/nfl-challenger-compare";
fs.mkdirSync(OUT, { recursive: true });

if (!fs.existsSync(REPORT)) {
  console.error(JSON.stringify({
    ok: false,
    error: "walkforward-report-missing",
    hint: "run: python scripts/nfl-pro-v1-1-walkforward.py",
    path: REPORT,
  }));
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
const root = path.dirname(fileURLToPath(import.meta.url));
const { evaluateMarketPromotionGate } = await import(
  pathToFileURL(path.join(root, "../functions/lib/nflProjectionImprovements.js")).href
);

function metricBlock(label, block) {
  if (!block || typeof block !== "object") {
    return { label, n: null, marginMae: null, totalMae: null, winnerAccuracy: null, available: false };
  }
  return {
    label,
    available: true,
    n: block.n ?? null,
    marginMae: block.marginMae ?? null,
    totalMae: block.totalMae ?? null,
    winnerAccuracy: block.winnerAccuracy ?? null,
  };
}

const models = {
  v11: metricBlock("NFL-PRO-v1.1", report.v11),
  v12: metricBlock("NFL-PRO-v1.2", report.v12),
  v2: metricBlock("NFL-PRO-v2-research", report.v2),
  v13: metricBlock("NFL-PRO-v1.3-research", report.v13),
  baseline: metricBlock("form-baseline", report.baseline),
  market: metricBlock("closing-market-benchmark", report.market),
};

const primary = ["v11", "v12", "v2"].map((k) => models[k]).filter((m) => m.available && m.n != null);
const primaryNs = [...new Set(primary.map((m) => m.n))];
const allNs = [...new Set(
  Object.values(models).filter((m) => m.available && m.n != null).map((m) => m.n)
)];

const comparison = {
  schema: "nfl-challenger-compare-v1",
  generatedAt: new Date().toISOString(),
  sourceReport: REPORT,
  evaluation: {
    design: report.design || null,
    ridgeAlpha: report.ridgeAlpha ?? null,
    nestedBlendSelection: report.nestedBlendSelection ?? null,
    primaryModels: ["v11", "v12", "v2"],
    identicalChronologicalWindows: primaryNs.length === 1,
    primarySampleN: primaryNs[0] ?? null,
    allSampleNs: allNs,
    note: primaryNs.length === 1
      ? "v1.1 / v1.2 / v2 share the same OOS n from one walk-forward run (identical chronological windows)."
      : "Primary model sample sizes differ — do not treat as paired identical-window evidence.",
  },
  models,
  deltasVsV11: {
    v12: report.deltas ? {
      marginMae: report.v12 && report.v11 ? report.v12.marginMae - report.v11.marginMae : null,
      totalMae: report.v12 && report.v11 ? report.v12.totalMae - report.v11.totalMae : null,
      winnerAccuracy: report.v12 && report.v11 ? report.v12.winnerAccuracy - report.v11.winnerAccuracy : null,
    } : null,
    v2: {
      marginMae: report.v2 && report.v11 ? report.v2.marginMae - report.v11.marginMae : null,
      totalMae: report.v2 && report.v11 ? report.v2.totalMae - report.v11.totalMae : null,
      winnerAccuracy: report.v2 && report.v11 ? report.v2.winnerAccuracy - report.v11.winnerAccuracy : null,
    },
  },
  beatsV11: report.beatsV11 || null,
  beatsMarket: report.beatsMarket || null,
  promotionEvidencePass: report.promotionEvidencePass ?? false,
  economic: {
    available: false,
    note: "Walk-forward report does not include ATS/CLV economics; keep NULL until priced paired sample exists. Market promotion gate requires CLV before researchGatePassed.",
    ats: null,
    totals: null,
    clv: null,
    validClvN: 0,
  },
  calibration: {
    available: false,
    brier: null,
    logLoss: null,
    note: "Probability calibration not in this walk-forward artifact; report NULL.",
  },
  governance: {
    researchOnly: true,
    automaticPromotion: false,
    canAuthorizeWager: false,
    productionChampionUnchanged: true,
    championFrozen: "NFL-PRO-v1.1",
    recommendation: report.promotionEvidencePass
      ? "Promotion evidence flag true in report — still requires operator approval; this script never promotes."
      : "No promotion. Challengers remain shadow/research.",
  },
};

const marketGate = evaluateMarketPromotionGate({
  challenger: models.v12.available ? models.v12 : null,
  market: models.market.available ? models.market : null,
  identicalChronologicalWindows: Boolean(comparison.evaluation.identicalChronologicalWindows),
  operatorApproved: false,
  economicClvAvailable: false,
});
comparison.marketPromotionGate = marketGate;
// Stricter: report flag alone is insufficient without beats-close + CLV + operator.
comparison.researchGatePassed = marketGate.researchGatePassed;
comparison.promotionEvidencePass = Boolean(
  (report.promotionEvidencePass ?? false) && marketGate.beatsClosingOnIdenticalWindows
);
comparison.governance.recommendation = marketGate.recommendation;

fs.writeFileSync(path.join(OUT, "challenger-compare.json"), JSON.stringify(comparison, null, 2));
console.log(JSON.stringify({
  ok: true,
  identicalWindows: comparison.evaluation.identicalChronologicalWindows,
  n: comparison.evaluation.primarySampleN,
  v11MarginMae: models.v11.marginMae,
  v12MarginMae: models.v12.marginMae,
  v2MarginMae: models.v2.marginMae,
  marketMarginMae: models.market.marginMae,
  beatsClosingOnIdenticalWindows: comparison.marketPromotionGate?.beatsClosingOnIdenticalWindows ?? false,
  promotionEvidencePass: comparison.promotionEvidencePass,
  researchGatePassed: comparison.researchGatePassed,
  automaticPromotion: false,
}));
process.exit(0);
