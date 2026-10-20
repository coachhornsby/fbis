#!/usr/bin/env node
/**
 * Read-only audit: do fresh Q4 Polymarket WS observations reach today board cards?
 * Uses public /api/today plus Cloudflare-free observation samples passed via stdin
 * or a local JSON file. When Q4_SAMPLE_JSON is unset, audits board diagnostics only.
 */
import { readFile } from "node:fs/promises";
import { evaluateQ4CardDelivery } from "./lib/q4CardDeliveryAudit.mjs";

const BASE = process.env.FBIS_BASE_URL || "https://fbis-myz.pages.dev";
const sport = process.env.AUDIT_SPORT || "nhl";

const today = await fetch(`${BASE}/api/today?sport=${encodeURIComponent(sport)}&_t=${Date.now()}`, {
  headers: { "cache-control": "no-cache" },
  signal: AbortSignal.timeout(45000),
}).then(async (r) => {
  if (!r.ok) throw new Error(`TODAY_HTTP_${r.status}`);
  return r.json();
});

let q4Observations = [];
if (process.env.Q4_SAMPLE_JSON) {
  q4Observations = JSON.parse(await readFile(process.env.Q4_SAMPLE_JSON, "utf8"));
}

const report = evaluateQ4CardDelivery({
  q4Observations,
  boardGames: today.games || [],
  now: new Date(),
});

const out = {
  ...report,
  board: {
    health: today.health?.state || null,
    marketsAvailable: today.health?.marketsAvailable ?? null,
    polymarketResearch: today.polymarketResearch || null,
    openFailures: today.health?.openFailures || [],
  },
  sport,
  base: BASE,
};

console.log(JSON.stringify(out, null, 2));
if (!out.ok && q4Observations.length) process.exitCode = 1;
