#!/usr/bin/env node
/**
 * Continuous sport shadow delta sync ops. PRIMARY remains authoritative.
 * Uses bounded requests so Pages Function wall-clock limits are not exceeded.
 */
import { appendFile } from "node:fs/promises";

const BASE = process.env.FBIS_BASE_URL || "https://fbis-myz.pages.dev";
const SECRET = process.env.HARVEST_SECRET || "";
const SPORT = String(process.env.SPORT || "nhl").toLowerCase();
const INCLUDE_PREFIX = process.env.INCLUDE_PREFIX === "true";
const ROUNDS = Math.min(6, Number(process.env.SYNC_ROUNDS) || 3);
const PAGE_SIZE = Math.min(500, Number(process.env.SYNC_PAGE_SIZE) || 250);
const MAX_PAGES = Math.min(20, Number(process.env.SYNC_MAX_PAGES) || 8);
const PREFIX_PAGE_SIZE = Math.min(200, Number(process.env.PREFIX_PAGE_SIZE) || 100);
const PREFIX_MAX_PAGES = Math.min(10, Number(process.env.PREFIX_MAX_PAGES) || 4);
const REQUEST_TIMEOUT_MS = Math.min(540_000, Number(process.env.SYNC_TIMEOUT_MS) || 240_000);

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
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`TOPOLOGY_${operation}_INVALID_JSON_HTTP_${response.status}`);
  }
  if (response.status === 403) throw new Error("TOPOLOGY_FORBIDDEN");
  if (!response.ok) {
    throw new Error(`TOPOLOGY_${operation}_HTTP_${response.status}_${body?.error || body?.reason || "ERROR"}`);
  }
  return body;
}

// Working-set first (games / predictions / published_projections).
const sync = await postTopology("sport-delta-sync", {
  sport: SPORT,
  rounds: ROUNDS,
  includePrefix: false,
  pageSize: PAGE_SIZE,
  maxPages: MAX_PAGES,
});

let prefix = null;
if (INCLUDE_PREFIX) {
  // Separate bounded prefix pass so a large research table cannot abort the working set.
  prefix = await postTopology("sport-prefix-copy", {
    sport: SPORT,
    pageSize: PREFIX_PAGE_SIZE,
    maxPages: PREFIX_MAX_PAGES,
    resume: true,
  });
}

const parity = await postTopology("sport-parity", { sport: SPORT });

const failures = [];
if (sync.ok !== true) failures.push(sync.reason || "SYNC_NOT_OK");
if (sync.productStillPrimary !== true) failures.push("PRODUCT_MUST_STAY_PRIMARY");
if (INCLUDE_PREFIX && prefix && prefix.ok !== true) {
  // Prefix tables may be absent / mid-heal; soft-fail only hard transport errors.
  // Schema drift is healed additively on each pass (ALTER ADD COLUMN); incomplete
  // pages (moreRemaining) are expected until the research backfill catches up.
  const softReasons = new Set([
    "SPORT_DB_UNBOUND",
    "SPORT_DB_NOT_PROVISIONED",
    "PRIMARY_TABLE_MISSING",
  ]);
  const results = Array.isArray(prefix.results) ? prefix.results : [];
  const hard = results.filter((r) => {
    if (r.ok) return false;
    if (softReasons.has(r.reason)) return false;
    const err = String(r.error || "");
    // Transient D1 blips / pre-heal schema drift — next scheduled pass retries.
    if (/Network connection lost|D1_ERROR:\s*Failed query|has no column named/i.test(err)) return false;
    return true;
  });
  if (!softReasons.has(prefix.reason) && hard.length) {
    failures.push(prefix.reason || `PREFIX_COPY_NOT_OK:${hard.map((h) => h.table).slice(0, 5).join(",")}`);
  }
}
if (sync.canAuthorizeWager === true || parity.canAuthorizeWager === true) {
  failures.push("WAGER_AUTHORITY_MUST_STAY_FALSE");
}

const out = {
  ok: failures.length === 0,
  failures,
  sport: SPORT,
  sync: {
    ok: sync.ok === true,
    caughtUp: sync.caughtUp === true,
    moreRemaining: sync.moreRemaining === true,
    passes: sync.passes || [],
    parity: sync.parity || null,
  },
  prefix,
  parity,
  productStillPrimary: true,
  includePrefix: INCLUDE_PREFIX,
  canAuthorizeWager: false,
  cutoverAuthorized: false,
};

console.log(JSON.stringify(out, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `## Sport delta sync — ${SPORT}`,
      "",
      `| ok | ${out.ok} |`,
      `| caughtUp | ${out.sync.caughtUp} |`,
      `| moreRemaining | ${out.sync.moreRemaining} |`,
      `| prefixOk | ${prefix ? prefix.ok === true : "skipped"} |`,
      `| productStillPrimary | true |`,
      `| cutoverAuthorized | false |`,
      `| canAuthorizeWager | false |`,
      "",
    ].join("\n")
  );
}

if (!out.ok) process.exit(1);
