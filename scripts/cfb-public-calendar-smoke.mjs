#!/usr/bin/env node
/** Research-only source coverage check. No D1, sportsbook or model writes. */
import fs from "node:fs";
import crypto from "node:crypto";
import { loadCfbPublicWeek } from "../functions/lib/cfbPublicSchedule.js";
import { isFbsVsFbsGame } from "../functions/lib/cfbGameVisibility.js";
import { resetCacheMem } from "../functions/lib/cache.js";

const date = process.argv[2] || "2026-10-11";
const output = process.argv[3] || null;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error("Invalid ISO date");
const audit = {
  source: "ESPN_PUBLIC_SCOREBOARD",
  requestedDate: date,
  observedAt: new Date().toISOString(),
  classification: "READ_ONLY_PUBLIC_FBS_SCHEDULE_AUDIT",
  projectionsUpdated: false, betsAuthorized: false,
  bookmakerRequests: 0, externalPaidProviderRequests: 0, weeks: [],
};
let invalid = false;
for (const shift of [0, 1]) {
  resetCacheMem();
  try {
    const response = await loadCfbPublicWeek(date, {}, shift, fetch);
    const games = response.games || [];
    const ids = new Set(), failures = [];
    for (const g of games) {
      if (!isFbsVsFbsGame(g)) failures.push("NON_FBS:" + g.id);
      if (!g.id || ids.has(String(g.id))) failures.push("DUPLICATE_ID:" + g.id);
      ids.add(String(g.id));
      const d = String(g.start || "").slice(0, 10);
      if (d < response.range.since || d > response.range.until) failures.push("DATE_OUT_OF_RANGE:" + g.id);
    }
    if (response.coverage?.requestedDays !== 7 || response.coverage?.successfulDays !== 7) failures.push("PARTIAL_PUBLIC_DAY_COVERAGE");
    if (games.length < 20) failures.push("LESS_THAN_20_VERIFIED_WEEK_GAMES");
    if (response.coverage?.failures?.length) failures.push(...response.coverage.failures.map(e => "SOURCE_ERROR:" + e.day + ":" + e.error));
    audit.weeks.push({
      shift, range: response.range, games: games.length,
      sample: games.slice(0, 8).map(g => ({id:g.id, start:g.start, away:g.away?.name, home:g.home?.name})),
      gameIdsSha256: crypto.createHash("sha256").update([...ids].sort().join("\n")).digest("hex"),
      coverage: response.coverage, failures, passed: failures.length === 0,
    });
    if (failures.length) invalid = true;
  } catch(e) {
    invalid = true;
    audit.weeks.push({shift,passed:false,failures:["FETCH_FAILED:" + String(e.message||e)]});
  }
}
audit.passed = !invalid;
const outputText = JSON.stringify(audit, null, 2) + "\n";
if (output) fs.writeFileSync(output, outputText);
console.log(outputText);
if (invalid) process.exitCode = 1;
