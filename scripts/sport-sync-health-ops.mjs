#!/usr/bin/env node
/** All-sport sync health rollup. PRIMARY remains authoritative. */
import { appendFile } from "node:fs/promises";

const BASE = process.env.FBIS_BASE_URL || "https://fbis-myz.pages.dev";
const SECRET = process.env.HARVEST_SECRET || "";

async function postTopology(operation, extra = {}) {
  if (!SECRET) throw new Error("HARVEST_SECRET_REQUIRED");
  const response = await fetch(`${BASE}/api/database-topology`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-harvest-secret": SECRET,
      "cache-control": "no-cache",
    },
    body: JSON.stringify({ operation, ...extra }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`TOPOLOGY_${operation}_INVALID_JSON_HTTP_${response.status}`);
  }
  if (!response.ok) throw new Error(`TOPOLOGY_${operation}_HTTP_${response.status}`);
  return body;
}

const health = await postTopology("sport-sync-health-all");
const failures = [];
// Authoritative sports intentionally no longer use PRIMARY and stop shadow copying.
// Validate each sport against its deployed mode instead of the retired all-PRIMARY invariant.
const sports = Array.isArray(health.sports) ? health.sports : [];
if (sports.length !== 11 || health.sportCount !== 11) failures.push("SPORT_INVENTORY_INCOMPLETE");
const authoritative = new Set(["nfl", "cfb", "nhl"]);
for (const row of sports) {
  const shouldUseSport = authoritative.has(row.sport);
  if (shouldUseSport) {
    if (row.mode !== "sport" || row.productStillPrimary !== false) {
      failures.push(`CUTOVER_ROUTING_INVALID:${row.sport}`);
    }
    // Frozen PRIMARY-to-sport last_copy_at is expected once sport is authoritative.
  } else if (row.mode === "sport" || row.productStillPrimary !== true) {
    failures.push(`UNAUTHORIZED_SPORT_ROUTING:${row.sport}`);
  }
}
if (health.cutoverAuthorized === true) failures.push("CUTOVER_MUST_STAY_CLOSED");
if (health.canAuthorizeWager === true) failures.push("WAGER_AUTHORITY_MUST_STAY_FALSE");

const out = {
  ok: failures.length === 0,
  failures,
  sportCount: health.sportCount,
  parityOkCount: health.parityOkCount,
  allProductPrimary: health.allProductPrimary,
  authorityRoutingValid: failures.every((f) => !f.includes("ROUTING_")),
  authoritativeSports: [...authoritative],
  cutoverAuthorized: false,
  deletionAuthorized: false,
  canAuthorizeWager: false,
  sports: health.sports,
};

console.log(JSON.stringify(out, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = (health.sports || []).map((s) =>
    `| ${s.sport} | ${s.parityOk} | ${s.lagMs ?? ""} | ${s.prefixPresent}/${s.prefixExpected} | ${s.productStillPrimary} |`
  );
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Sport sync health (all 11)",
      "",
      `| sport | parityOk | lagMs | prefix | primary |`,
      `|---|---|---|---|---|`,
      ...lines,
      "",
      `| parityOkCount | ${out.parityOkCount}/${out.sportCount} |`,
      `| cutoverAuthorized | false |`,
      "",
    ].join("\n")
  );
}
if (!out.ok) process.exit(1);
