#!/usr/bin/env node
/**
 * Continuous sport shadow delta sync ops. PRIMARY remains authoritative.
 * Uses bounded requests so Pages Function wall-clock limits are not exceeded.
 */
import { appendFile } from "node:fs/promises";
import { createTopologyClient } from "./lib/topologyFetch.mjs";

const BASE = process.env.FBIS_BASE_URL || "https://fbis-myz.pages.dev";
const SECRET = process.env.HARVEST_SECRET || "";
const SPORT = String(process.env.SPORT || "nhl").toLowerCase();
const INCLUDE_PREFIX = process.env.INCLUDE_PREFIX === "true";
const ROUNDS = Math.min(6, Number(process.env.SYNC_ROUNDS) || 3);
const PAGE_SIZE = Math.min(500, Number(process.env.SYNC_PAGE_SIZE) || 250);
const MAX_PAGES = Math.min(20, Number(process.env.SYNC_MAX_PAGES) || 8);
const PREFIX_PAGE_SIZE = Math.min(250, Number(process.env.PREFIX_PAGE_SIZE) || 150);
const PREFIX_MAX_PAGES = Math.min(20, Number(process.env.PREFIX_MAX_PAGES) || 12);
const PREFIX_ROUNDS = Math.min(4, Number(process.env.PREFIX_ROUNDS) || 2);
const REQUEST_TIMEOUT_MS = Math.min(540_000, Number(process.env.SYNC_TIMEOUT_MS) || 360_000);

const { postTopology } = createTopologyClient({
  base: BASE,
  secret: SECRET,
  timeoutMs: REQUEST_TIMEOUT_MS,
  retries: 3,
});

// Working-set first (games / predictions / published_projections).
const sync = await postTopology("sport-delta-sync", {
  sport: SPORT,
  rounds: ROUNDS,
  includePrefix: false,
  pageSize: PAGE_SIZE,
  maxPages: MAX_PAGES,
});

let prefix = null;
const prefixPasses = [];
let prefixTransportError = null;
if (INCLUDE_PREFIX) {
  // One large request for all tables frequently hits Pages' wall-clock/503
  // limit on CFB, NHL, CBB and tennis. The endpoint already accepts tables[],
  // so isolate each bounded table copy and keep a durable cursor per table.
  const scope = await postTopology("sport-migration-scope", { sport: SPORT });
  if (!Array.isArray(scope.prefixTables)) throw new Error("PREFIX_SCOPE_MISSING");
  const declaredTables = scope.prefixTables;
  const latest = new Map();
  let remaining = [...declaredTables];
  for (let round = 0; round < PREFIX_ROUNDS && remaining.length; round += 1) {
    const next = [];
    for (const table of remaining) {
      try {
        const pass = await postTopology("sport-prefix-copy", {
          sport: SPORT,
          tables: [table],
          pageSize: PREFIX_PAGE_SIZE,
          maxPages: PREFIX_MAX_PAGES,
          resume: true,
          skipCaughtUp: true,
        }, { retries: 2 });
        const row = (pass.results || []).find((r) => r.table === table);
        const skipped = (pass.skippedCaughtUp || []).some((r) => r.table === table);
        if (!row && !skipped) {
          throw new Error(`PREFIX_NO_TABLE_RECEIPT:${table}`);
        }
        const receipt = {
          table, round: round + 1,
          ok: skipped || row?.ok === true,
          copied: row?.copied || 0,
          exhausted: skipped || row?.exhausted === true,
          skipped,
          reason: row?.reason || row?.error || null,
        };
        prefixPasses.push(receipt);
        latest.set(table, receipt);
        if (!receipt.exhausted || !receipt.ok) next.push(table);
      } catch (error) {
        prefixTransportError = String(error?.message || error?.cause?.message || error).slice(0, 240);
        const receipt = {
          table, round: round + 1, ok: false, softFailed: true,
          reason: "PREFIX_TABLE_TRANSPORT_FAILED", error: prefixTransportError,
        };
        prefixPasses.push(receipt);
        latest.set(table, receipt);
        next.push(table);
      }
    }
    remaining = next;
  }
  const results = [...latest.values()];
  const hardFailures = results.filter((r) => !r.ok && !r.softFailed);
  const softFailures = results.filter((r) => r.softFailed);
  prefix = {
    ok: hardFailures.length === 0 && softFailures.length === 0,
    softFailed: hardFailures.length === 0 && softFailures.length > 0,
    reason: hardFailures.length ? "PREFIX_TABLE_COPY_FAILED" :
      softFailures.length ? "PREFIX_TRANSPORT_SOFT_FAIL" : null,
    tableCount: declaredTables.length,
    results,
    moreRemaining: remaining.length > 0,
    remainingTables: remaining,
    transportErrors: softFailures.length,
  };
}

const parity = await postTopology("sport-parity", { sport: SPORT });
let prefixParity = null;
if (INCLUDE_PREFIX) {
  try {
    prefixParity = await postTopology("sport-prefix-parity", { sport: SPORT });
  } catch (error) {
    prefixParity = {
      ok: false,
      softFailed: true,
      status: "PREFIX_PARITY_TRANSPORT_SOFT_FAIL",
      error: String(error?.message || error?.cause?.message || error).slice(0, 240),
    };
  }
}

const failures = [];
if (sync.ok !== true) failures.push(sync.reason || "SYNC_NOT_OK");
if (sync.productStillPrimary !== true) failures.push("PRODUCT_MUST_STAY_PRIMARY");
if (INCLUDE_PREFIX && prefix && prefix.ok !== true && prefix.softFailed !== true) {
  // Prefix tables may be absent / mid-heal; soft-fail only hard transport errors.
  // Schema drift is healed additively on each pass (ALTER ADD COLUMN); incomplete
  // pages (moreRemaining) are expected until the research backfill catches up.
  const softReasons = new Set([
    "SPORT_DB_UNBOUND",
    "SPORT_DB_NOT_PROVISIONED",
    "PRIMARY_TABLE_MISSING",
    "PREFIX_TRANSPORT_SOFT_FAIL",
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
  prefixPasses: prefixPasses.length || undefined,
  prefixProgress: prefixPasses,
  prefixParity,
  parity,
  productStillPrimary: true,
  includePrefix: INCLUDE_PREFIX,
  canAuthorizeWager: false,
  cutoverAuthorized: false,
  // Explicit: working-set parity alone is not a complete sport migration.
  // PREFIX_EMPTY_OK (NPB/KBO) or 0=0 working-set parity is not migration.
  fullSportMigration: prefixParity?.ok === true
    && Number(prefixParity.tableCount) > 0
    && parity?.ok === true
    && [
      ...(parity?.tables || []),
      ...(prefixParity?.tables || []),
    ].some(row => Number(row.primaryCount) > 0),
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
      `| prefixParity | ${prefixParity ? prefixParity.status : "skipped"} |`,
      `| fullSportMigration | ${out.fullSportMigration === true} |`,
      `| productStillPrimary | true |`,
      `| cutoverAuthorized | false |`,
      `| canAuthorizeWager | false |`,
      "",
    ].join("\n")
  );
}

if (!out.ok) process.exit(1);
