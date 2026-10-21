#!/usr/bin/env node
/**
 * Bounded, resumable heavy-table D1 backfill sprint.
 * Writes ONLY into the target sport's SHADOW D1 via authenticated topology API.
 * Never changes authority, deletes rows, or authorizes a wager.
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createTopologyClient } from "./lib/topologyFetch.mjs";

const SPORT = String(process.env.SPORT || "").toLowerCase();
const TABLE = String(process.env.TABLE || "");
const SECRET = process.env.HARVEST_SECRET || "";
const ALLOWED_SPORTS = new Set(["cfb", "nhl", "nba", "mlb", "cbb", "wnba", "soccer", "tennis"]);
const BASE = process.env.FBIS_BASE_URL || "https://fbis-myz.pages.dev";
if (!ALLOWED_SPORTS.has(SPORT)) throw new Error("UNAPPROVED_SPORT_FOR_BACKFILL");
if (!/^[a-z][a-z0-9_]*$/.test(TABLE) || !TABLE.startsWith(SPORT + "_")) {
  throw new Error("INVALID_SPORT_PREFIX_TABLE");
}
if (!SECRET) throw new Error("HARVEST_SECRET_REQUIRED");

const { postTopology } = createTopologyClient({
  base: BASE, secret: SECRET, timeoutMs: 150000, retries: 2,
});
const scope = await postTopology("sport-migration-scope", { sport: SPORT });
if (!Array.isArray(scope.prefixTables) || !scope.prefixTables.includes(TABLE)) {
  throw new Error("TABLE_NOT_IN_AUTHORIZED_SHADOW_MANIFEST");
}
if (scope.cutoverAuthorized === true || scope.canAuthorizeWager === true) {
  throw new Error("UNEXPECTED_AUTHORITY_ON_MIGRATION_SCOPE");
}

const maxPasses = Math.min(180, Math.max(1, Number(process.env.MAX_PASSES) || 110));
const deadline = Date.now() + Math.min(23 * 60 * 1000, Math.max(60000, Number(process.env.BUDGET_MS) || 21 * 60 * 1000));
const pageSize = Math.min(250, Math.max(50, Number(process.env.PAGE_SIZE) || 200));
const maxPages = Math.min(10, Math.max(1, Number(process.env.MAX_PAGES) || 5));
const startedAt = new Date().toISOString();
const history = [];
let copied = 0;
let status = "PROGRESSING";
let lastError = null;
let lastSource = null;
let lastTarget = null;
let consecutiveIdle = 0;

async function inspect() {
  const p = await postTopology("sport-prefix-parity", { sport: SPORT });
  const row = (p.tables || []).find(x => x.table === TABLE);
  if (!row || row.primaryCount == null || row.sportCount == null) {
    throw new Error("PREFIX_COUNT_PROBE_MISSING");
  }
  lastSource = row.primaryCount;
  lastTarget = row.sportCount;
  return row;
}

let current = await inspect();
if (current.status === "PARITY") status = "PARITY";
for (let passNo = 1; passNo <= maxPasses && status !== "PARITY" && Date.now() < deadline; passNo++) {
  try {
    const response = await postTopology("sport-prefix-copy", {
      sport: SPORT, tables: [TABLE], resume: true, skipCaughtUp: true,
      pageSize, maxPages,
    });
    const row = (response.results || []).find(x => x.table === TABLE);
    const skipped = (response.skippedCaughtUp || []).some(x => x.table === TABLE);
    if (!row && !skipped) throw new Error("PREFIX_COPY_RECEIPT_MISSING");
    if (row?.ok === false || response.productStillPrimary === false || response.canAuthorizeWager === true) {
      throw new Error(row?.reason || row?.error || "PREFIX_COPY_SAFETY_FAILURE");
    }
    const added = Number(row?.copied || 0);
    copied += added;
    history.push({ pass: passNo, copied: added, exhausted: Boolean(row?.exhausted), skipped });
    // One full prefix parity query checks every declared research table.
    // Avoid issuing that expensive multi-table probe on every 1k-row page.
    let checked = null;
    if (row?.exhausted || skipped || added === 0 || passNo % 8 === 0) {
      checked = await inspect();
    }
    console.log(JSON.stringify({
      sport: SPORT, table: TABLE, pass: passNo, copied: added,
      primaryCount: checked?.primaryCount ?? lastSource,
      shadowCount: checked?.sportCount ?? lastTarget,
      gap: checked ? checked.primaryCount - checked.sportCount : null,
    }));
    if (checked?.status === "PARITY") { status = "PARITY"; break; }
    if (added === 0) consecutiveIdle += 1;
    else consecutiveIdle = 0;
    if (consecutiveIdle >= 2) {
      status = "NO_PROGRESS";
      break;
    }
  } catch (error) {
    lastError = String(error?.message || error).slice(0, 300);
    status = "FAILED";
    break;
  }
}
// Capture authoritative final count parity, even on a bounded continuation.
if (status !== "FAILED") {
  try {
    const final = await inspect();
    if (final.status === "PARITY") status = "PARITY";
  } catch (error) {
    lastError = String(error?.message || error).slice(0, 300);
    status = "FAILED";
  }
}
const receipt = {
  ok: status === "PARITY" || status === "PROGRESSING",
  status, sport: SPORT, table: TABLE, startedAt,
  endedAt: new Date().toISOString(), passes: history.length,
  rowsApplied: copied, primaryCount: lastSource, shadowCount: lastTarget,
  remaining: lastSource == null || lastTarget == null ? null : lastSource - lastTarget,
  lastError, productStillPrimary: true, cutoverAuthorized: false,
  canAuthorizeWager: false,
  progress: history,
};
await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/sprint-${SPORT}-${TABLE}.json`, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ ...receipt, progress: undefined }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## ${SPORT.toUpperCase()} / ${TABLE}\nStatus: **${status}**; applied ${copied} rows; remaining ${receipt.remaining ?? "unknown"}; authority PRIMARY only.\n`);
}
if (!receipt.ok) process.exitCode = 1;
