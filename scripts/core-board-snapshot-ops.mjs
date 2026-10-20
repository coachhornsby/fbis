#!/usr/bin/env node
/**
 * Publish CORE cross-sport board snapshot, then require-fresh within 15 minutes.
 * Authenticated with HARVEST_SECRET. Failures exit non-zero for cron alerting.
 */
import { appendFile } from "node:fs/promises";
import {
  CORE_BOARD_SUMMARY_MAX_AGE_MS,
  evaluateCoreSnapshotOpsCycle,
} from "./lib/coreBoardSnapshotOps.mjs";

const BASE = process.env.FBIS_BASE_URL || "https://fbis-myz.pages.dev";
const SECRET = process.env.HARVEST_SECRET || "";
const MAX_AGE_MS = Number(process.env.CORE_BOARD_MAX_AGE_MS) || CORE_BOARD_SUMMARY_MAX_AGE_MS;

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
    signal: AbortSignal.timeout(120000),
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

const publish = await postTopology("core-board-summary-publish");
const freshness = await postTopology("core-board-summary-require-fresh", {
  maxAgeMs: MAX_AGE_MS,
});
const report = evaluateCoreSnapshotOpsCycle({
  publish,
  freshness,
  now: new Date(),
  maxAgeMs: MAX_AGE_MS,
});

const out = {
  ...report,
  publishAsOf: publish?.summary?.asOf || null,
  freshnessAsOf: freshness?.asOf || null,
  sportCount: publish?.summary?.sports?.length ?? null,
  incompleteSports: publish?.summary?.incompleteSports || [],
  base: BASE,
};

console.log(JSON.stringify(out, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    "## CORE board snapshot ops",
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| ok | ${out.ok} |`,
    `| publish asOf | ${out.publishAsOf || "n/a"} |`,
    `| freshness asOf | ${out.freshnessAsOf || "n/a"} |`,
    `| ageMs | ${out.freshness?.ageMs ?? "n/a"} |`,
    `| maxAgeMs | ${out.freshness?.maxAgeMs ?? MAX_AGE_MS} |`,
    `| sportCount | ${out.sportCount ?? "n/a"} |`,
    `| failures | ${out.failures.join(", ") || "none"} |`,
    `| canAuthorizeWager | false |`,
    "",
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
}

if (!out.ok) process.exitCode = 1;
