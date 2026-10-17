#!/usr/bin/env node
/**
 * Offline-only CORE challenger evaluation.
 * Usage:
 *   node scripts/cfb-core-shadow-backtest.mjs artifacts/private-pit-cfb-rows.jsonl artifacts/cfb-core-shadow-report.json
 * Input: JSONL (or JSON array) of frozen records:
 * {gameId,season,week,kickoff,finalAt,finalVerified:true,
 *  baselineHome,baselineAway,home:{coreYear,coreThroughWeek,coreOffense,
 *  coreDefense,coreWeekBounded,coreSourceAsOf,coreSourceEndpoint},
 *  away:{...},actualHome,actualAway}
 * No network, no quota consumption; never accesses or dumps private tokens.
 */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {evaluateCoreWalkForward} from "../functions/lib/cfbCoreBacktest.js";

const file=process.argv[2],reportFile=process.argv[3]||"artifacts/cfb-core-shadow-backtest.json";
if(!file) {
  console.error("USAGE: node scripts/cfb-core-shadow-backtest.mjs <frozen-pit-input.jsonl> [report.json]");
  process.exit(2);
}
let rows;
try {
  const content=readFileSync(resolve(file),"utf8");
  rows=content.trimStart().startsWith("[")?JSON.parse(content):
    content.split(/\r?\n/).filter(x=>x.trim()).map(x=>JSON.parse(x));
  if(!Array.isArray(rows))throw Error("expected JSON array or newline-delimited JSON");
} catch(e) {
  console.error("CORE_BACKTEST_INPUT_ERROR:",e?.message||String(e));
  process.exit(2);
}
const report=evaluateCoreWalkForward(rows);
mkdirSync(dirname(reportFile),{recursive:true});
writeFileSync(reportFile,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({
  modelId:report.modelId,eligibleRows:report.eligibleRows,
  rejected:report.excluded,folds:report.folds.length,
  comparison:report.comparison,verifiedOos:report.verifiedOos,
  authority:report.authority,reportFile,
}));
if(!report.verifiedOos)process.exitCode=3;
