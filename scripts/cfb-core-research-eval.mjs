#!/usr/bin/env node
/**
 * Offline CFB CORE research evaluation (Champion vs CORE vs Combined + market edge).
 * Usage:
 *   node scripts/cfb-core-research-eval.mjs [frozen-pit-rows.jsonl] [report.json]
 * Without input rows, writes an explicit data-limitation report.
 */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {evaluateCfbCoreResearch} from "../functions/lib/cfbCoreEvaluation.js";

const file = process.argv[2];
const reportFile = process.argv[3] || "artifacts/cfb-core-research-eval.json";
let rows = [];
if (file) {
  try {
    const content = readFileSync(resolve(file), "utf8");
    rows = content.trimStart().startsWith("[")
      ? JSON.parse(content)
      : content.split(/\r?\n/).filter(x => x.trim()).map(x => JSON.parse(x));
    if (!Array.isArray(rows)) throw Error("expected JSON array or JSONL");
  } catch (e) {
    console.error("CORE_RESEARCH_INPUT_ERROR:", e?.message || String(e));
    process.exit(2);
  }
}

const report = rows.length
  ? evaluateCfbCoreResearch(rows)
  : evaluateCfbCoreResearch([]);

mkdirSync(dirname(reportFile), {recursive: true});
writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({
  modelId: report.modelId,
  eligibleRows: report.eligibleRows,
  folds: report.folds?.length || 0,
  classification: report.classification,
  comparison: report.comparison,
  ablation: report.ablation,
  dataLimitations: report.dataLimitations,
  verifiedOos: report.verifiedOos,
  authority: report.authority,
  canAuthorizeWager: false,
  reportFile,
}, null, 2));

if (!rows.length || report.classification === "Unable to evaluate due to data limitations") {
  process.exitCode = 3;
}
