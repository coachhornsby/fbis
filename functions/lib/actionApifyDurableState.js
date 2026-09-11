/**
 * Durable Action/Apify candidate scheduler state (D1).
 *
 * In-memory guards remain a local fast path only.
 * Lease, circuit, and MTD budget authority live in D1 so cold starts
 * and multi-isolate Workers cannot double-spend or lose breaker state.
 *
 * Shadow/candidate only — never ODDS_PROVIDER_ORDER, never wager gates.
 */

import { ACTION_APIFY_PROVIDER } from "./actionApifyShadow.js";

export const DEFAULT_LEASE_TTL_MS = 6 * 60 * 1000;
export const DEFAULT_CIRCUIT_TTL_MS = 30 * 60 * 1000;

/**
 * @param {string} sport
 * @param {string} profile
 * @param {string} [lifecycle]
 */
export function schedulerScopeKey(sport, profile, lifecycle = "") {
  return [String(sport || "").toLowerCase(), String(profile || "BASE").toUpperCase(), String(lifecycle || "").toLowerCase()]
    .filter(Boolean)
    .join(":");
}

/**
 * Month-to-date spend from cost ledger.
 * Prefers actual_total_usd when present, else estimated_total_usd.
 * @param {object} db — { queryOne }
 * @param {{ now?: Date }} [opts]
 */
export async function queryMonthToDateSpendUsd(db, opts = {}) {
  if (!db?.queryOne) return { mtdUsd: 0, basis: 0, basisActual: 0 };
  const now = opts.now || new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const row = await db.queryOne(
    `SELECT
       COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END), 0) AS mtd_usd,
       COUNT(*) AS runs,
       SUM(CASE WHEN actual_total_usd IS NOT NULL THEN 1 ELSE 0 END) AS runs_actual
     FROM shadow_cost_ledger
     WHERE created_at >= ?`,
    [monthStart]
  );
  return {
    mtdUsd: Number(row?.mtd_usd || 0),
    runs: Number(row?.runs || 0),
    runsActual: Number(row?.runs_actual || 0),
    monthStart,
  };
}

/**
 * Load durable scheduler row.
 */
export async function loadSchedulerState(db, { provider = ACTION_APIFY_PROVIDER, scopeKey }) {
  if (!db?.queryOne) return null;
  return (
    (await db.queryOne(
      `SELECT * FROM shadow_candidate_scheduler_state WHERE provider = ? AND scope_key = ?`,
      [provider, scopeKey]
    )) || null
  );
}

/**
 * Atomic-ish lease acquire for D1.
 * Winner: no active unexpired lease, or same runId reclaim.
 * Abandoned leases (expires_at < now) are reclaimable.
 */
export async function acquireSchedulerLease(db, {
  provider = ACTION_APIFY_PROVIDER,
  scopeKey,
  runId,
  ttlMs = DEFAULT_LEASE_TTL_MS,
  now = new Date(),
}) {
  if (!db?.exec || !db?.queryOne) {
    return { ok: true, mode: "memory-only", leaseExpiresAt: new Date(now.getTime() + ttlMs).toISOString() };
  }
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const existing = await loadSchedulerState(db, { provider, scopeKey });

  if (existing?.active_run_id && existing.lease_expires_at && Date.parse(existing.lease_expires_at) > now.getTime()) {
    if (existing.active_run_id !== runId) {
      return {
        ok: false,
        code: "OVERLAP",
        message: `active lease held by ${existing.active_run_id} until ${existing.lease_expires_at}`,
        existing,
      };
    }
  }

  if (existing?.circuit_open_until && Date.parse(existing.circuit_open_until) > now.getTime()) {
    return {
      ok: false,
      code: "CIRCUIT_OPEN",
      message: `circuit open until ${existing.circuit_open_until}`,
      existing,
    };
  }

  if (!existing) {
    await db.exec(
      `INSERT INTO shadow_candidate_scheduler_state (
        provider, scope_key, active_run_id, lease_acquired_at, lease_expires_at,
        consecutive_failures, circuit_open_until, last_run_id, last_run_at,
        last_success_at, last_error_class, last_error_message, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
      [provider, scopeKey, runId, nowIso, expiresAt, nowIso]
    );
  } else {
    // Conditional update: only if lease free/expired/ours
    await db.exec(
      `UPDATE shadow_candidate_scheduler_state
       SET active_run_id = ?, lease_acquired_at = ?, lease_expires_at = ?, updated_at = ?
       WHERE provider = ? AND scope_key = ?
         AND (
           active_run_id IS NULL
           OR lease_expires_at IS NULL
           OR lease_expires_at < ?
           OR active_run_id = ?
         )`,
      [runId, nowIso, expiresAt, nowIso, provider, scopeKey, nowIso, runId]
    );
    const after = await loadSchedulerState(db, { provider, scopeKey });
    if (!after || after.active_run_id !== runId) {
      return {
        ok: false,
        code: "OVERLAP",
        message: `lost lease race to ${after?.active_run_id || "unknown"}`,
        existing: after,
      };
    }
  }

  return { ok: true, mode: "durable", leaseExpiresAt: expiresAt };
}

/**
 * Release lease; optionally record success/failure for circuit.
 */
export async function releaseSchedulerLease(db, {
  provider = ACTION_APIFY_PROVIDER,
  scopeKey,
  runId,
  success = false,
  errorClass = null,
  errorMessage = null,
  circuitThreshold = 5,
  circuitTtlMs = DEFAULT_CIRCUIT_TTL_MS,
  now = new Date(),
}) {
  if (!db?.exec || !db?.queryOne) return { released: false };
  const nowIso = now.toISOString();
  const existing = await loadSchedulerState(db, { provider, scopeKey });
  if (!existing) return { released: false };

  let consecutive = Number(existing.consecutive_failures || 0);
  let circuitOpenUntil = existing.circuit_open_until || null;
  if (success) {
    consecutive = 0;
    circuitOpenUntil = null;
  } else if (errorClass && errorClass !== "budget_blocked" && errorClass !== "overlap_blocked") {
    consecutive += 1;
    if (consecutive >= circuitThreshold) {
      circuitOpenUntil = new Date(now.getTime() + circuitTtlMs).toISOString();
    }
  }

  await db.exec(
    `UPDATE shadow_candidate_scheduler_state
     SET active_run_id = CASE WHEN active_run_id = ? THEN NULL ELSE active_run_id END,
         lease_expires_at = CASE WHEN active_run_id = ? THEN NULL ELSE lease_expires_at END,
         consecutive_failures = ?,
         circuit_open_until = ?,
         last_run_id = ?,
         last_run_at = ?,
         last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END,
         last_error_class = ?,
         last_error_message = ?,
         updated_at = ?
     WHERE provider = ? AND scope_key = ?`,
    [
      runId,
      runId,
      consecutive,
      circuitOpenUntil,
      runId,
      nowIso,
      success ? 1 : 0,
      nowIso,
      errorClass,
      errorMessage ? String(errorMessage).slice(0, 400) : null,
      nowIso,
      provider,
      scopeKey,
    ]
  );
  return { released: true, consecutiveFailures: consecutive, circuitOpenUntil };
}

/**
 * Build logical collection key for run-level idempotency.
 * scheduledBucket: floor to minute (or caller-supplied) so retries collide.
 */
export function buildLogicalCollectionKey({
  provider = ACTION_APIFY_PROVIDER,
  sport,
  lifecycle,
  profile,
  date = null,
  scheduledBucket = null,
}) {
  const bucket =
    scheduledBucket ||
    new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  return [provider, sport, lifecycle || "", profile || "BASE", date || "", bucket].join("|");
}
