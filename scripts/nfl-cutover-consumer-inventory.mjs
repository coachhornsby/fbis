#!/usr/bin/env node
/**
 * Read-only NFL cutover consumer inventory. An inventory is NOT a cutover approval.
 * Scans deployed Pages functions and orchestration sources for direct PRIMARY access.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";

const roots = ["functions/api", "functions/lib", "services/sports-projection-orchestrator"];
const scanExt = /\.(?:js|mjs|cjs|ts)$/;
const nflSignal = /\bnfl\b|NFL|buildSlate|prediction_snapshots|published_projections|sportDb|projection/i;
const directPrimary = /(?:context\.|ctx\.)?env\.DB\b|\bDB:\s*(?:context\.|ctx\.)?env\.DB\b|\b(?:context|ctx)\.env\.DB\b/;
const sportRouter = /productSportDbHandle|resolveSportDb|deployedSportDbMode/;
const sqlWrite = /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b|\.prepare\s*\(/i;
const core = /CORE_DB|buildCrossSportBoardSummary|coreBoard|cross_sport/i;
const rows = [];
async function walk(dir) {
  let files;
  try { files = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of files) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(file); continue; }
    if (!scanExt.test(entry.name)) continue;
    const source = await readFile(file, "utf8");
    if (!nflSignal.test(source)) continue;
    const lines = source.split("\n");
    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (directPrimary.test(line) || sportRouter.test(line) || core.test(line)) {
        matches.push({
          line: i + 1,
          kind: directPrimary.test(line) ? "DIRECT_PRIMARY_REFERENCE" : sportRouter.test(line) ? "ROUTER_REFERENCE" : "CORE_DEPENDENCY",
          code: line.trim().slice(0, 220),
        });
      }
    }
    if (!matches.length) continue;
    rows.push({
      path: relative(".", file).replaceAll("\\", "/"),
      nflSignal: true,
      directPrimaryReference: matches.some(x => x.kind === "DIRECT_PRIMARY_REFERENCE"),
      routerReference: matches.some(x => x.kind === "ROUTER_REFERENCE"),
      sqlOrWriteSignal: sqlWrite.test(source),
      matches,
      // Static scanning cannot prove the actual SQL target or live traffic.
      disposition: "UNREVIEWED",
    });
  }
}
for (const root of roots) await walk(root);
rows.sort((a,b) => a.path.localeCompare(b.path));
const exposed = rows.filter(x => x.directPrimaryReference);
const report = {
  contract: "fbis-nfl-cutover-consumer-inventory-v1",
  generatedAt: new Date().toISOString(),
  source: "repository-static-scan",
  roots,
  candidateFiles: rows.length,
  directPrimaryCandidateFiles: exposed.length,
  // Fail-closed: this report is informational only, never an approval.
  readyForLiveCutover: false,
  authorityActivationPerformed: false,
  deletionAuthorized: false,
  canAuthorizeWager: false,
  blockers: [
    "REVIEW_ALL_NFL_READ_WRITE_CONSUMERS",
    "VERIFY_REAL_TRAFFIC_AND_FRESH_WRITE_CONSISTENCY",
    "PROVE_LIVE_ROLLBACK_WITH_CORE_BOARD",
    "OBTAIN_EXPLICIT_INDEPENDENT_APPROVAL",
  ],
  candidates: rows,
};
const out = process.argv[2];
if (out) {
  await mkdir(join(out, ".."), { recursive: true });
  await writeFile(out, JSON.stringify(report,null,2)+"\n");
}
console.log(JSON.stringify(report,null,2));
