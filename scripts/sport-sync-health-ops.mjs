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
if (health.allProductPrimary !== true) failures.push("PRODUCT_MUST_STAY_PRIMARY");
if (health.cutoverAuthorized === true) failures.push("CUTOVER_MUST_STAY_CLOSED");
if (health.canAuthorizeWager === true) failures.push("WAGER_AUTHORITY_MUST_STAY_FALSE");

const out = {
  ok: failures.length === 0,
  failures,
  sportCount: health.sportCount,
  parityOkCount: health.parityOkCount,
  allProductPrimary: health.allProductPrimary,
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
