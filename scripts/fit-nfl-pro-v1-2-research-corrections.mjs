#!/usr/bin/env node
/**
 * Fit research-only score residuals + Platt for NFL-PRO-v1.2 display corrections.
 * Writes data/models/nfl-pro-v1-2-research-corrections-YYYYMMDD.json
 * and prints the JS-literal fields to mirror into nflProV12ResearchCorrections.js.
 *
 * Research only — never alters NFL-PRO-v1.1 champion or wager authority.
 *
 * Usage:
 *   node scripts/fit-nfl-pro-v1-2-research-corrections.mjs path/to/graded-rows.json
 *
 * graded-rows.json: [{ pHomeWin, actualHome, actualAway, frozenAt? }, ...]
 */
import fs from "node:fs";
import path from "node:path";
import { fitCalibrator, scoreMetrics, probabilityMetrics } from "../functions/lib/continuousLearning.js";

const input = process.argv[2];
if (!input || !fs.existsSync(input)) {
  console.error(JSON.stringify({
    ok: false,
    error: "graded-rows-json-required",
    hint: "node scripts/fit-nfl-pro-v1-2-research-corrections.mjs graded-rows.json",
  }));
  process.exit(2);
}

const rows = JSON.parse(fs.readFileSync(input, "utf8"));
const scored = [];
const binary = [];
for (const r of rows) {
  const home = Number(r.actualHome ?? r.actual_home);
  const away = Number(r.actualAway ?? r.actual_away);
  const ph = Number(r.projHome ?? r.home);
  const pa = Number(r.projAway ?? r.away);
  const p = Number(r.pHomeWin ?? r.p ?? r.p_home);
  if (![home, away, ph, pa].every(Number.isFinite)) continue;
  scored.push({
    marginErr: (ph - pa) - (home - away),
    totalErr: (ph + pa) - (home + away),
  });
  if (home === away || !Number.isFinite(p)) continue;
  binary.push({
    p,
    pHome: p,
    actual_home: home,
    actual_away: away,
    y: home > away ? 1 : 0,
    frozenAt: r.frozenAt || r.frozen_at || "",
  });
}

const marginBias = scored.length
  ? scored.reduce((s, r) => s + r.marginErr, 0) / scored.length
  : 0;
const totalBias = scored.length
  ? scored.reduce((s, r) => s + r.totalErr, 0) / scored.length
  : 0;
const marginMae = scored.length
  ? scored.reduce((s, r) => s + Math.abs(r.marginErr), 0) / scored.length
  : null;
const totalMae = scored.length
  ? scored.reduce((s, r) => s + Math.abs(r.totalErr), 0) / scored.length
  : null;

const calibrator = fitCalibrator(binary, { method: "platt" });
const rawMetrics = probabilityMetrics(binary);
const calibratedRows = binary.map((r) => ({
  ...r,
  p: calibrator ? calibrator.predict(r.p) : r.p,
}));
const calMetrics = probabilityMetrics(calibratedRows);

const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const out = {
  schema: "nfl-pro-v1-2-research-corrections-v1",
  fittedAt: new Date().toISOString(),
  targetModel: {
    modelId: "NFL-PRO-v1",
    version: "v1.2",
    role: "research-board-primary",
  },
  championUnchanged: "NFL-PRO-v1.1",
  sample: {
    n: scored.length,
    nBinary: binary.length,
    source: path.basename(input),
    marginMae,
    totalMae,
    marginBias,
    totalBias,
    rawBrier: rawMetrics?.brier ?? null,
    calibratedBrier: calMetrics?.brier ?? null,
    rawLogLoss: rawMetrics?.logLoss ?? null,
    calibratedLogLoss: calMetrics?.logLoss ?? null,
    rawEce: rawMetrics?.ece ?? null,
    calibratedEce: calMetrics?.ece ?? null,
  },
  scoreResiduals: {
    marginResidual: -marginBias,
    totalResidual: -totalBias,
    note: "marginResidual added to projected margin via home+=r/2, away-=r/2; totalResidual as +half to each side",
  },
  platt: calibrator
    ? {
        method: "platt",
        intercept: calibrator.params.intercept,
        weight: calibrator.params.weights[0],
        formula: "sigmoid(intercept + weight * logit(p))",
      }
    : null,
  caps: { marginResidualAbs: 3.5, totalResidualAbs: 4.0 },
  marketPromotionGate: {
    requireBeatsClosingOnIdenticalWindows: true,
    metrics: ["marginMae", "totalMae", "winnerAccuracy"],
    automaticPromotion: false,
    operatorApprovalRequired: true,
  },
  featureFamilyPolicy: {
    trenches: "NULL_UNTIL_AUTHORIZED_SOURCE",
    specialTeams: "NULL_UNTIL_AUTHORIZED_SOURCE",
    neverImpute: true,
  },
  weakResearchQuarantine: ["research-v0.1-form-calibrated", "research-v0-form"],
  lifecycle: "RESEARCH_CORRECTIONS",
  canAuthorizeWager: false,
  altersChampion: false,
};

const outPath = path.join("data/models", `nfl-pro-v1-2-research-corrections-${day}.json`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({
  ok: true,
  path: outPath,
  n: scored.length,
  nBinary: binary.length,
  marginResidual: out.scoreResiduals.marginResidual,
  totalResidual: out.scoreResiduals.totalResidual,
  platt: out.platt,
  note: "Mirror into functions/lib/nflProV12ResearchCorrections.js for Workers runtime.",
}, null, 2));
process.exit(calibrator ? 0 : 1);
