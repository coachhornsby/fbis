#!/usr/bin/env node
/**
 * Continuous sport shadow delta sync ops. PRIMARY remains authoritative.
 */
import { appendFile } from "node:fs/promises";

const BASE = process.env.FBIS_BASE_URL || "https://fbis-myz.pages.dev";
const SECRET = process.env.HARVEST_SECRET || "";
const SPORT = String(process.env.SPORT || "nhl").toLowerCase();
const INCLUDE_PREFIX = process.env.INCLUDE_PREFIX === "true";
const ROUNDS = Math.min(20, Number(process.env.SYNC_ROUNDS) || 8);

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
    signal: AbortSignal.timeout(300000),
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

const sync = await postTopology("sport-delta-sync", {
  sport: SPORT,
  rounds: ROUNDS,
  includePrefix: INCLUDE_PREFIX,
  pageSize: 1000,
  maxPages: 50,
});

const parity = await postTopology("sport-parity", { sport: SPORT });

const failures = [];
if (sync.ok !== true) failures.push(sync.reason || "SYNC_NOT_OK");
if (sync.productStillPrimary !== true) failures.push("PRODUCT_MUST_STAY_PRIMARY");
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
    prefix: sync.prefix || null,
    parity: sync.parity || null,
  },
  parity,
  productStillPrimary: true,
  includePrefix: INCLUDE_PREFIX,
  canAuthorizeWager: false,
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
      `| productStillPrimary | true |`,
      `| canAuthorizeWager | false |`,
      "",
    ].join("\n")
  );
}

if (!out.ok) process.exit(1);
