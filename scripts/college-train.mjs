/** Offline, dataset-driven college validation. It never trains inside a Worker. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { walkForwardValidation } from "../functions/lib/walkForward.js";
import { evaluatePromotion } from "../functions/lib/collegeModels.js";

const input = resolve(process.env.CFB_BACKTEST_FILE || "data/backtests/cfb-validation.jsonl");
if (!existsSync(input)) {
  console.error(JSON.stringify({ ok: false, status: "insufficient-evidence", error: `Missing ${input}. Supply frozen as-of game rows through CFB_BACKTEST_FILE.` }));
  process.exit(2);
}
const text = readFileSync(input, "utf8").trim();
const rows = input.endsWith(".jsonl") ? text.split(/\r?\n/).filter(Boolean).map(JSON.parse) : JSON.parse(text);
const report = walkForwardValidation(rows, {
  champion: "champion",
  challenger: "enriched",
  ablations: ["withoutEpa", "withoutTransfer", "withoutQb", "withoutCoaching", "withoutReturning", "withoutTalent"],
});
report.input = { file: input, n: rows.length };
report.promotion = evaluatePromotion({
  n: report.challenger.n,
  maeImproved: report.maeTotalImprovement >= 0.15,
  biasAbs: Math.abs(report.challenger.biasTotal ?? 99),
  brierDegradation: report.challenger.brier != null && report.champion.brier != null ? report.challenger.brier - report.champion.brier : 99,
  coverage: report.challenger.n / Math.max(1, rows.length),
  seasons: report.seasons.length,
  leakageOk: report.leakageOk,
  artifactOk: true,
  operatorApproved: false,
});
const output = resolve("data/models/validation-report.json");
if (process.argv.includes("--write")) writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.sufficient && report.leakageOk, sufficient: report.sufficient, n: report.challenger.n, seasons: report.seasons, promotion: report.promotion }, null, 2));
if (!report.sufficient || !report.leakageOk) process.exit(3);
