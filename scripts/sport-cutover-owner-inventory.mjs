#!/usr/bin/env node
/** Fail-closed read-only owner inventory before independent sport D1 cutovers. */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { SPORT_PREFIX_TABLES } from "../functions/lib/sportWorkingCopy.js";

const sports = Object.keys(SPORT_PREFIX_TABLES).filter(s => s !== "nfl");
const roots = ["functions/api", "functions/lib", "services/sports-projection-orchestrator"];
const inspected = [];
async function walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(path); continue; }
    if (!/\.(js|mjs|cjs|ts)$/.test(entry.name)) continue;
    inspected.push({ path: path.replaceAll("\\","/"), source: await readFile(path, "utf8") });
  }
}
for (const root of roots) await walk(root);
const report = {
  contract: "FBIS-SPORT-CUTOVER-OWNERSHIP-v1",
  at: new Date().toISOString(),
  sports: {},
  authorityActivated: false,
  primaryRowsDeleted: 0,
  canAuthorizeWager: false,
};
for (const sport of sports) {
  const tableNames = SPORT_PREFIX_TABLES[sport];
  const mentions = new RegExp(tableNames.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
    "|\\b" + sport + "\\b", "i");
  const primary = /(?:context\.|ctx\.)?env\.DB\b|\b(?:context|ctx)\.env\.DB\b/;
  const routing = /productSportDbHandle|resolveSportDb|deployedSportDbMode|SportDbHandle/;
  const shared = /prediction_snapshots|published_projections|odds_snapshots|team_form|\bgames\b|\bpredictions\b/;
  const results = inspected.filter(x => mentions.test(x.source)).map(x => ({
    path: x.path,
    primaryCandidate: primary.test(x.source),
    routerReference: routing.test(x.source),
    sharedLedgerCandidate: shared.test(x.source),
    potentiallyWrites: /\b(INSERT|UPDATE|DELETE|REPLACE)\b|\.run\(/i.test(x.source),
    disposition: "REQUIRES_RECORD_LEVEL_OWNER_REVIEW",
  }));
  report.sports[sport] = {
    prefixTables: tableNames,
    scannedFiles: results.length,
    primaryCandidates: results.filter(x => x.primaryCandidate).length,
    sharedLedgerCandidates: results.filter(x => x.sharedLedgerCandidate).length,
    readyForLiveCutover: false,
    consumerReviewComplete: false,
    consumers: results,
  };
}
const destination = process.argv[2] || "artifacts/sport-cutover-owner-inventory.json";
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ contract: report.contract,
  sports: Object.fromEntries(Object.entries(report.sports).map(([s,v])=>[s,{
    scannedFiles:v.scannedFiles,primaryCandidates:v.primaryCandidates,
    sharedLedgerCandidates:v.sharedLedgerCandidates
  }])),
  authorityActivated:false,
},null,2));
