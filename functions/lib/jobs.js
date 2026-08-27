/**
 * Durable pipeline job records. Module-memory counters are request-local only.
 */

import { MODEL_VERSION } from "./weights.js";
import { hasDb, persistJobRun, queryJobHealth, setMeta } from "./store.js";

export const JOB_SUCCESS = "success";
export const JOB_PARTIAL = "partial";
export const JOB_FAILED = "failed";

export function deploymentCommit(env) {
  return env?.CF_PAGES_COMMIT_SHA || env?.CF_PAGES_COMMIT || env?.GITHUB_SHA || env?.COMMIT_SHA || null;
}

export function newJobId(jobType) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${jobType}:${Date.now()}:${rand}`;
}

export function emptyWriteCounts() {
  return {
    snapshotsAttempted: 0,
    snapshotsInserted: 0,
    snapshotsAlready: 0,
    snapshotsFailed: 0,
    writesAttempted: 0,
    writesSucceeded: 0,
    writesFailed: 0,
  };
}

export function mergeWriteCounts(a, b) {
  const out = emptyWriteCounts();
  for (const k of Object.keys(out)) out[k] = (Number(a?.[k]) || 0) + (Number(b?.[k]) || 0);
  return out;
}

export function classifyJobStatus({ okSports, failedSports, writesFailed, unbound, requiredFailed }) {
  if (unbound || requiredFailed) return JOB_FAILED;
  if (failedSports > 0 && okSports === 0) return JOB_FAILED;
  if (failedSports > 0 || writesFailed > 0) return JOB_PARTIAL;
  return JOB_SUCCESS;
}

export function httpStatusForJob(status) {
  if (status === JOB_SUCCESS) return 200;
  if (status === JOB_PARTIAL) return 207;
  return 500;
}

export function jobPayload({
  ok,
  job,
  status,
  attemptedAt,
  successfulAt,
  sports,
  dates,
  gamesDiscovered,
  writes,
  finals,
  d1,
  errors,
  env,
}) {
  const w = writes || emptyWriteCounts();
  const f = finals || { discovered: 0, graded: 0, failed: 0 };
  return {
    ok: Boolean(ok),
    job,
    status,
    attempted_at: attemptedAt,
    successful_at: successfulAt,
    sports: sports || [],
    dates: dates || [],
    games_discovered: gamesDiscovered ?? 0,
    snapshots_attempted: w.snapshotsAttempted,
    snapshots_inserted: w.snapshotsInserted,
    snapshots_already_present: w.snapshotsAlready,
    snapshots_failed: w.snapshotsFailed,
    finals_discovered: f.discovered,
    finals_graded: f.graded,
    finals_failed: f.failed,
    d1: d1 || { bound: false },
    errors: errors || [],
    deployment_commit: deploymentCommit(env),
    model_version: MODEL_VERSION,
  };
}

export async function recordJob(env, row) {
  const started = row.startedAt || row.attemptedAt;
  const completed = row.completedAt || (row.status === JOB_SUCCESS ? row.successfulAt : new Date().toISOString());
  const payload = {
    id: row.id || newJobId(row.jobType),
    jobType: row.jobType,
    triggerType: row.triggerType || "http",
    startedAt: started,
    completedAt: completed,
    status: row.status,
    sport: row.sport || "all",
    datesJson: JSON.stringify(row.dates || []),
    gamesDiscovered: row.gamesDiscovered ?? 0,
    writesAttempted: row.writesAttempted ?? 0,
    writesSucceeded: row.writesSucceeded ?? 0,
    writesFailed: row.writesFailed ?? 0,
    finalsDiscovered: row.finalsDiscovered ?? 0,
    finalsGraded: row.finalsGraded ?? 0,
    errorSummary: (row.errors || []).slice(0, 8).join(" | ") || null,
    deploymentCommit: deploymentCommit(env),
    modelVersion: MODEL_VERSION,
  };
  const persist = await persistJobRun(env, payload);
  return { ...payload, persistOk: persist.ok, persistReason: persist.reason || null };
}

export async function stampAttempt(env, kind, iso) {
  if (kind === "collect") await setMeta(env, "last_collect_attempt_at", iso);
  if (kind === "harvest") await setMeta(env, "last_harvest_attempt_at", iso);
}

export async function stampSuccess(env, kind, iso) {
  if (kind === "collect") {
    await setMeta(env, "last_collect_success_at", iso);
    await setMeta(env, "last_collect_at", iso);
  }
  if (kind === "harvest") {
    await setMeta(env, "last_harvest_success_at", iso);
    await setMeta(env, "last_harvest_at", iso);
  }
  await setMeta(env, "last_d1_write_success_at", iso);
}

export async function durableHealth(env) {
  const bound = hasDb(env);
  const health = await queryJobHealth(env);
  return {
    bound,
    source: bound ? "d1" : "unbound",
    ...health,
  };
}

/** Last expected collect is stale if no success inside ~4h during the daytime CT window, or >14h overnight. */
export function staleScheduleWarning(health, now = new Date()) {
  const collectAt = health?.lastCollectSuccessAt || health?.last_collect_success_at;
  const harvestAt = health?.lastHarvestSuccessAt || health?.last_harvest_success_at;
  const warnings = [];
  const hours = (iso) => {
    if (!iso) return Infinity;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return Infinity;
    return (now.getTime() - t) / 3600000;
  };
  const collectAge = hours(collectAt);
  const harvestAge = hours(harvestAt);
  if (!collectAt || collectAge > 14) {
    warnings.push("Last successful scheduled collect is missing or stale.");
  } else if (collectAge > 4) {
    const hourCT = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(now)
    );
    if (hourCT >= 8 && hourCT <= 22) {
      warnings.push("Last successful collect is older than 4 hours during the CT collection window.");
    }
  }
  if (!harvestAt || harvestAge > 30) {
    warnings.push("Last successful scheduled harvest is missing or stale.");
  }
  return warnings;
}
