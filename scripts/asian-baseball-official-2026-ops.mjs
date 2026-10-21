#!/usr/bin/env node
/**
 * Bounded official-source 2026 Asian baseball history ingestion.
 * Uses existing authenticated FBIS API, preserving raw source provenance.
 * No generated game rows, wagering authority, source deletion or D1 cutover.
 */
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.FBIS_BASE_URL || "https://fbis-myz.pages.dev";
const SECRET = process.env.HARVEST_SECRET || "";
const LEAGUE = String(process.env.LEAGUE || "").toUpperCase();
const SEASON = Number(process.env.SEASON || 2026);
const MONTH = Number(process.env.MONTH || 0);
if (!SECRET) throw new Error("HARVEST_SECRET_REQUIRED");
if (!["KBO", "NPB"].includes(LEAGUE) || SEASON !== 2026 || ![8, 9].includes(MONTH)) {
  throw new Error("HISTORICAL_SOURCE_SCOPE_REJECTED");
}
const url = `${BASE}/api/asian-baseball-history-backfill`;
const headers = {
  "content-type": "application/json",
  "x-harvest-secret": SECRET,
  "cache-control": "no-cache",
};
async function request(method, uri, body = null) {
  let err = null;
  for (let n = 0; n < 4; n++) {
    try {
      const response = await fetch(uri, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(125000),
      });
      const result = await response.json();
      if (response.ok && result?.ok === true) return result;
      err = new Error(`ASIAN_HISTORY_HTTP_${response.status}:${result?.error || result?.reason || "invalid-result"}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) throw err;
    } catch (error) {
      err = error;
    }
    await new Promise(resolve => setTimeout(resolve, 1600 * (n + 1)));
  }
  throw err || new Error("ASIAN_HISTORY_RETRIES_EXHAUSTED");
}
const attempts = [];
const allowedPasses = LEAGUE === "NPB" ? 1 : 5;
for (let index = 0; index < allowedPasses; index++) {
  const result = await request("POST", url, {
    league: LEAGUE, season: SEASON, month: MONTH,
    maxRequests: LEAGUE === "NPB" ? 1 : 7,
  });
  attempts.push({
    status: result.status, requests: result.requests ?? null,
    discovered: result.discovered ?? null, persisted: result.persisted ?? null,
    cursor: result.cursor || null, alreadyComplete: result.alreadyComplete === true,
  });
  if (result.status === "DONE") break;
  if (result.status !== "PARTIAL") throw new Error(`UNEXPECTED_SHARD_STATUS_${result.status}`);
}
const report = await request("GET", `${url}?league=${LEAGUE}&season=${SEASON}&month=${MONTH}`);
const proof = {
  ok: Number(report.persistedGames) > 0 && report.ok === true,
  league: LEAGUE, season: SEASON, month: MONTH,
  persistedGames: report.persistedGames || 0,
  completedResultCoverage: report.completedResultCoverage ?? null,
  canonicalTeamMappingCoverage: report.canonicalTeamMappingCoverage ?? null,
  temporalMetadataCoverage: report.temporalMetadataCoverage ?? null,
  sourceStatus: report.status || null, attempts,
  sourceAuthority: "OFFICIAL_PROVIDER_ARCHIVED_TO_PRIMARY",
  cutoverAuthorized: false, deletionAuthorized: false, canAuthorizeWager: false,
};
await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/asian-history-${LEAGUE.toLowerCase()}-${SEASON}-${MONTH}.json`, JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));
if (!proof.ok) process.exitCode = 1;
