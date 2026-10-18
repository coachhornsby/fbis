#!/usr/bin/env node
/**
 * Capacity relief: retire CURRENT Polymarket US WebSocket ticks older than a
 * live board window from primary D1 after optional ID evidence capture.
 *
 * Default: DRY_RUN (counts + size only).
 * APPLY requires:
 *   STORAGE_CURRENT_WS_RELIEF_APPLY=true
 *   STORAGE_CURRENT_WS_RELIEF_RELEASE_ID matching the authorized package
 *
 * Never deletes rows newer than the keep window. Never touches RESEARCH/CFB.
 * can_qualify / can_authorize_wager remain 0 for this observational cohort.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PRIMARY_DB, MARKET_HISTORY_DB } from "./lib/storage-retire-gates.mjs";

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const out = process.env.RELIEF_OUTPUT || "/tmp/fbis-current-ws-capacity-relief";
const packagePath =
  process.env.STORAGE_CURRENT_WS_RELIEF_PACKAGE ||
  resolve("docs/storage-current-ws-capacity-relief-authorized-20261018.json");
const keepHours = Math.max(1, Math.min(48, Number(process.env.STORAGE_CURRENT_WS_KEEP_HOURS || 2)));
const batchLimit = Math.max(100, Math.min(5000, Number(process.env.STORAGE_CURRENT_WS_BATCH || 5000)));
const maxBatches = Math.max(1, Math.min(500, Number(process.env.STORAGE_CURRENT_WS_MAX_BATCHES || 40)));
const apply = process.env.STORAGE_CURRENT_WS_RELIEF_APPLY === "true";
const releaseId = process.env.STORAGE_CURRENT_WS_RELIEF_RELEASE_ID || null;

if (!token || !account) throw new Error("CREDENTIALS_REQUIRED");

const pred =
  `snapshot_type='CURRENT' AND source='Polymarket US WebSocket' ` +
  `AND datetime(COALESCE(source_observed_at, collected_at)) < datetime('now','-${keepHours} hours')`;

const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers = { Authorization: `Bearer ${token}` };

async function api(path, body) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { ...headers, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error("CLOUDFLARE_API_" + res.status + ":" + JSON.stringify(data.errors || data));
  }
  return data.result;
}

async function query(dbId, sql) {
  const r = await api(`/d1/database/${dbId}/query`, { sql });
  const row = r[0];
  if (!row?.success) throw new Error("QUERY_FAILED");
  return row;
}

const pkg = JSON.parse(await readFile(packagePath, "utf8"));
if (apply) {
  if (pkg.retentionReleaseAuthorized !== true) throw new Error("RETENTION_RELEASE_NOT_AUTHORIZED");
  if (!releaseId || String(pkg.releaseId) !== String(releaseId)) throw new Error("RELEASE_ID_MISMATCH");
  if (pkg.primaryDb && pkg.primaryDb !== PRIMARY_DB) throw new Error("PRIMARY_DB_MISMATCH");
  if (pkg.cohort?.source !== "Polymarket US WebSocket") throw new Error("COHORT_SOURCE_MISMATCH");
}

await mkdir(out, { recursive: true });
const evidence = {
  contract: "fbis-current-ws-capacity-relief-v1",
  startedAt: new Date().toISOString(),
  mode: apply ? "APPLY" : "DRY_RUN",
  releaseId: apply ? releaseId : null,
  keepHours,
  batchLimit,
  maxBatches,
  primaryDb: PRIMARY_DB,
  marketHistoryDb: MARKET_HISTORY_DB,
  predicate: pred,
  sourceRowsDeleted: 0,
  completed: false,
};

evidence.primaryStart = await api(`/d1/database/${PRIMARY_DB}`);
evidence.historyStart = await api(`/d1/database/${MARKET_HISTORY_DB}`);
evidence.eligible = (await query(PRIMARY_DB, `SELECT COUNT(*) AS n FROM normalized_market_observations WHERE ${pred}`))
  .results[0].n;
evidence.keepWindow = (
  await query(
    PRIMARY_DB,
    `SELECT COUNT(*) AS n FROM normalized_market_observations WHERE snapshot_type='CURRENT' AND source='Polymarket US WebSocket' AND datetime(COALESCE(source_observed_at, collected_at)) >= datetime('now','-${keepHours} hours')`,
  )
).results[0].n;
evidence.decisionLinks = (
  await query(PRIMARY_DB, "SELECT COUNT(*) AS n FROM normalized_market_decision_links")
).results[0].n;
evidence.economicGrades = (
  await query(PRIMARY_DB, "SELECT COUNT(*) AS n FROM normalized_market_economic_grades")
).results[0].n;

if (evidence.decisionLinks !== 0) throw new Error("REFUSE_DELETE_WITH_DECISION_LINKS");
if (Number(evidence.keepWindow) < 1 && apply) {
  // Soft warning only — recent window may be empty during stream outage.
  evidence.keepWindowWarning = "KEEP_WINDOW_EMPTY";
}

const samples = (
  await query(
    PRIMARY_DB,
    `SELECT id, observation_key, raw_payload_hash, collected_at, source_observed_at FROM normalized_market_observations WHERE ${pred} ORDER BY rowid LIMIT 50`,
  )
).results;
evidence.idSamples = samples;

if (apply) {
  for (let i = 0; i < maxBatches; i++) {
    const del = await query(
      PRIMARY_DB,
      `DELETE FROM normalized_market_observations WHERE rowid IN (SELECT rowid FROM normalized_market_observations WHERE ${pred} ORDER BY rowid LIMIT ${batchLimit})`,
    );
    const n = Number(del.meta?.changes || 0);
    evidence.sourceRowsDeleted += n;
    if (!n) break;
    if (i % 5 === 4) {
      evidence[`primaryAfterBatch${i + 1}`] = await api(`/d1/database/${PRIMARY_DB}`);
    }
  }
}

evidence.primaryEnd = await api(`/d1/database/${PRIMARY_DB}`);
evidence.historyEnd = await api(`/d1/database/${MARKET_HISTORY_DB}`);
evidence.eligibleRemaining = (
  await query(PRIMARY_DB, `SELECT COUNT(*) AS n FROM normalized_market_observations WHERE ${pred}`)
).results[0].n;
evidence.currentRemaining = (
  await query(PRIMARY_DB, "SELECT COUNT(*) AS n FROM normalized_market_observations WHERE snapshot_type='CURRENT'")
).results[0].n;
evidence.physicalBytesReclaimed =
  Number(evidence.primaryStart.file_size) - Number(evidence.primaryEnd.file_size);
evidence.completed = true;
evidence.finishedAt = new Date().toISOString();

await writeFile(resolve(out, "receipt.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ ok: true, ...evidence, idSamples: evidence.idSamples?.length }, null, 2));
