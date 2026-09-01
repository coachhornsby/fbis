/**
 * Durable pipeline job records. Module-memory counters are request-local only.
 */

import { MODEL_VERSION } from "./weights.js";
import { hasDb, persistJobRun, queryJobHealth, setMeta } from "./store.js";
import {
  lastExpectedCollectUtc,
  lastExpectedHarvestUtc,
  nextCronUtc,
  scheduledPipelineState,
} from "./pipelineSchedule.js";

export const JOB_SUCCESS = "success";
export const JOB_PARTIAL = "partial";
export const JOB_FAILED = "failed";

export function pipelineStageId({ stage, sport, runUrl, scope = "default", now = Date.now() }) {
  const runId = String(runUrl || "").match(/\/actions\/runs\/(\d+)/)?.[1];
  const safeScope = String(scope || "default").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80);
  return runId
    ? `${stage}:${sport || "all"}:${runId}:${safeScope}`
    : `${stage}:${sport || "all"}:${now}:${Math.random().toString(36).slice(2, 8)}`;
}

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
    immutableConflicts: 0,
    projectionsGenerated: 0,
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
  triggerType,
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
  cacheStatus,
}) {
  const w = writes || emptyWriteCounts();
  const f = finals || { discovered: 0, graded: 0, failed: 0, awaitingRetry: 0 };
  return {
    ok: Boolean(ok),
    job,
    status,
    trigger_type: triggerType || "http",
    attempted_at: attemptedAt,
    successful_at: successfulAt,
    sports: sports || [],
    dates: dates || [],
    games_discovered: gamesDiscovered ?? 0,
    projections_generated: w.projectionsGenerated || gamesDiscovered || 0,
    snapshots_attempted: w.snapshotsAttempted,
    snapshots_inserted: w.snapshotsInserted,
    snapshots_already_present: w.snapshotsAlready,
    immutable_conflicts: w.immutableConflicts || 0,
    snapshots_failed: w.snapshotsFailed,
    failed_writes: w.writesFailed,
    finals_discovered: f.discovered,
    finals_graded: f.graded,
    finals_failed: f.failed,
    finals_awaiting_retry: f.awaitingRetry ?? 0,
    cache_status: cacheStatus || null,
    d1: d1 || { bound: false },
    errors: errors || [],
    deployment_commit: deploymentCommit(env),
    model_version: MODEL_VERSION,
  };
}

/** GitHub Action accepts only HTTP 200 with status=success. Partial is rejected. */
export function actionAcceptsJob(httpCode, body) {
  return Number(httpCode) === 200 && body?.ok === true && body?.status === "success";
}

export function parseJobTrigger(request) {
  try {
    const url = new URL(request.url);
    const raw = (url.searchParams.get("trigger") || request.headers.get("x-fbis-trigger") || "http").toLowerCase();
    if (raw === "schedule") return "schedule";
    if (raw === "workflow_dispatch" || raw === "manual") return "workflow_dispatch";
    return "http";
  } catch {
    return "http";
  }
}

export function parseJobMode(request) {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "";
    return mode === "health" ? "health" : null;
  } catch {
    return null;
  }
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
    projectionsGenerated: row.projectionsGenerated ?? 0,
    writesAlready: row.writesAlready ?? 0,
    immutableConflicts: row.immutableConflicts ?? 0,
    finalsDiscovered: row.finalsDiscovered ?? 0,
    finalsGraded: row.finalsGraded ?? 0,
    finalsAwaitingRetry: row.finalsAwaitingRetry ?? 0,
    errorSummary: (row.errors || []).slice(0, 8).join(" | ") || null,
    deploymentCommit: deploymentCommit(env),
    modelVersion: MODEL_VERSION,
  };
  const persist = await persistJobRun(env, payload);
  return { ...payload, persistOk: persist.ok, persistReason: persist.reason || null };
}

function isScheduledTrigger(triggerType) {
  return triggerType === "schedule";
}

export async function stampAttempt(env, kind, iso, triggerType) {
  if (kind === "collect") {
    await setMeta(env, "last_collect_attempt_at", iso);
    if (isScheduledTrigger(triggerType)) await setMeta(env, "last_scheduled_collect_attempt_at", iso);
    else await setMeta(env, "last_manual_collect_attempt_at", iso);
  }
  if (kind === "harvest") {
    await setMeta(env, "last_harvest_attempt_at", iso);
    if (isScheduledTrigger(triggerType)) await setMeta(env, "last_scheduled_harvest_attempt_at", iso);
    else await setMeta(env, "last_manual_harvest_attempt_at", iso);
  }
}

export async function stampSuccess(env, kind, iso, triggerType) {
  if (kind === "collect") {
    await setMeta(env, "last_collect_success_at", iso);
    await setMeta(env, "last_collect_at", iso);
    if (isScheduledTrigger(triggerType)) await setMeta(env, "last_scheduled_collect_success_at", iso);
    else await setMeta(env, "last_manual_collect_success_at", iso);
  }
  if (kind === "harvest") {
    await setMeta(env, "last_harvest_success_at", iso);
    await setMeta(env, "last_harvest_at", iso);
    if (isScheduledTrigger(triggerType)) await setMeta(env, "last_scheduled_harvest_success_at", iso);
    else await setMeta(env, "last_manual_harvest_success_at", iso);
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

/** Scheduled-pipeline health. Manual success must not imply cron is healthy. */
export function scheduledHealth(health, now = new Date()) {
  const collectAt = health?.lastScheduledCollectSuccessAt || health?.last_scheduled_collect_success_at || null;
  const harvestAt = health?.lastScheduledHarvestSuccessAt || health?.last_scheduled_harvest_success_at || null;
  const collect = scheduledPipelineState({
    lastScheduledSuccessAt: collectAt,
    lastExpectedAt: lastExpectedCollectUtc(now),
    now,
    neverObserved: !collectAt,
    disabled: Boolean(health?.scheduleDisabled),
  });
  const harvest = scheduledPipelineState({
    lastScheduledSuccessAt: harvestAt,
    lastExpectedAt: lastExpectedHarvestUtc(now),
    now,
    neverObserved: !harvestAt,
    disabled: Boolean(health?.scheduleDisabled),
  });
  return {
    collect,
    harvest,
    nextCollect: nextCronUtc(now),
    lastEventType: health?.lastScheduledEventType || health?.last_scheduled_event_type || null,
    lastRunUrl: health?.lastScheduledRunUrl || health?.last_scheduled_run_url || null,
  };
}

export function staleScheduleWarning(health, now = new Date()) {
  const sched = scheduledHealth(health, now);
  const warnings = [];
  const label = (job, row) => {
    if (row.state === "never observed") return `SCHEDULED PIPELINE ${job}: never observed (manual runs do not count).`;
    if (row.state === "missed") return `SCHEDULED PIPELINE ${job}: missed last expected ${row.lastExpectedAt}.`;
    if (row.state === "delayed") return `SCHEDULED PIPELINE ${job}: delayed (grace window).`;
    if (row.state === "disabled") return `SCHEDULED PIPELINE ${job}: disabled.`;
    return null;
  };
  const c = label("collect", sched.collect);
  const h = label("harvest", sched.harvest);
  if (c) warnings.push(c);
  if (h) warnings.push(h);
  return warnings;
}
