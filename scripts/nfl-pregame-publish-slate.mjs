#!/usr/bin/env node
/**
 * Freeze the currently eligible NFL research checkpoint for every slate game.
 *
 * Permanent scheduler semantics:
 * - Publishes only the *current* checkpoint window (never invents past freezes).
 * - Reconciles coverage after publish; if games rolled into a new window or the
 *   first attempt raced deploy, retries with backoff until coverage is complete
 *   or attempts are exhausted.
 * - Soft exit 0 unless --strict; gaps are always written to artifacts.
 *
 * Env:
 *   BASE                production origin (default https://fbis-myz.pages.dev)
 *   HARVEST_SECRET      operator write secret
 *   ARTIFACT_DIR        output directory
 *   NFL_PUBLISH_DATE    optional YYYY-MM-DD
 *   EXPECTED_SHA        optional; only enforced when REQUIRE_DEPLOY_SHA=1
 *   REQUIRE_DEPLOY_SHA  set to 1 on function deploys; leave unset for cron/reconcile
 *   READY_ATTEMPTS      API readiness polls (default 24)
 *   RECONCILE_ATTEMPTS  publish/coverage reconcile loops (default 6)
 *   RECONCILE_DELAY_MS  base delay between reconcile attempts (default 8000)
 */
import fs from "node:fs";
import path from "node:path";
import { verifyDeploymentSha, resolveLiveProductionSha } from "./verify-deployment-sha.mjs";

const BASE = String(process.env.BASE || "https://fbis-myz.pages.dev").replace(/\/$/, "");
const SECRET = process.env.HARVEST_SECRET || "";
const OUT = process.env.ARTIFACT_DIR || "artifacts";
const DATE = process.env.NFL_PUBLISH_DATE || "";
const STRICT = process.argv.includes("--strict");
const EXPECTED_SHA = String(process.env.EXPECTED_SHA || "").toLowerCase();
const REQUIRE_DEPLOY_SHA = process.env.REQUIRE_DEPLOY_SHA === "1";
const READY_ATTEMPTS = Math.max(1, Number(process.env.READY_ATTEMPTS || 24) || 24);
const RECONCILE_ATTEMPTS = Math.max(1, Number(process.env.RECONCILE_ATTEMPTS || 6) || 6);
const RECONCILE_DELAY_MS = Math.max(1000, Number(process.env.RECONCILE_DELAY_MS || 8000) || 8000);

fs.mkdirSync(OUT, { recursive: true });

async function getJson(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 800) }; }
  return { http: res.status, body, contentType: res.headers.get("content-type") || "" };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiReady(probe) {
  if (probe.http === 405) return false;
  if (!probe.contentType.includes("application/json")) return false;
  if (!probe.body || typeof probe.body !== "object") return false;
  if (probe.body.ok !== true) return false;
  if (typeof probe.body.raw === "string" && /<!DOCTYPE html>/i.test(probe.body.raw)) return false;
  return true;
}

function coverageGaps(coverage) {
  const rows = coverage?.rows || [];
  return rows.filter((r) => r.currentEligible && !r.hasCurrentFreeze);
}

async function waitForPublishApi() {
  const coverageUrl = `${BASE}/api/nfl-pregame-publish?coverage=1${DATE ? `&date=${DATE}` : ""}`;
  let last = null;
  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt += 1) {
    last = await getJson(coverageUrl);
    last.attempt = attempt;
    if (apiReady(last)) return { ready: true, ...last };
    const delay = Math.min(15000, 1000 * attempt);
    console.log(JSON.stringify({ phase: "wait-api", attempt, http: last.http, delayMs: delay }));
    await sleep(delay);
  }
  return { ready: false, ...last };
}

async function postPublish(publishedBy) {
  return getJson(`${BASE}/api/nfl-pregame-publish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-harvest-secret": SECRET,
    },
    body: JSON.stringify({
      date: DATE || undefined,
      publishedBy,
      codeSha: process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || null,
      reconcile: true,
    }),
  });
}

async function fetchHealth() {
  const res = await fetch(`${BASE}/api/health?_t=${Date.now()}`);
  const contentType = res.headers.get("content-type") || "";
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, contentType, json };
}

// Soft deploy awareness: never block cron/reconcile on Pages SHA when only
// workflow files changed. Optional hard wait for function deploys.
let shaWait = null;
let liveSha = null;
if (REQUIRE_DEPLOY_SHA && /^[0-9a-f]{40}$/.test(EXPECTED_SHA)) {
  shaWait = await verifyDeploymentSha({ expectedSha: EXPECTED_SHA, fetchHealth });
  fs.writeFileSync(path.join(OUT, "nfl-pregame-deploy-wait.json"), JSON.stringify(shaWait, null, 2));
  console.log(JSON.stringify({ phase: "deploy-wait", outcome: shaWait?.outcome, reason: shaWait?.reason }));
} else {
  const resolved = await resolveLiveProductionSha({ fetchHealth, maxAttempts: 4 });
  liveSha = resolved?.productionSha || resolved?.actualSha || null;
  fs.writeFileSync(path.join(OUT, "nfl-pregame-live-sha.json"), JSON.stringify(resolved, null, 2));
  console.log(JSON.stringify({ phase: "live-sha", outcome: resolved?.outcome, sha: liveSha }));
}

const ready = await waitForPublishApi();
fs.writeFileSync(path.join(OUT, "nfl-pregame-api-ready.json"), JSON.stringify({
  ready: ready.ready,
  http: ready.http,
  attempt: ready.attempt,
  contentType: ready.contentType,
}, null, 2));

const statusBefore = ready.ready
  ? ready
  : await getJson(`${BASE}/api/nfl-pregame-publish?coverage=1${DATE ? `&date=${DATE}` : ""}`);
fs.writeFileSync(path.join(OUT, "nfl-pregame-coverage-before.json"), JSON.stringify(statusBefore.body, null, 2));

const reconcileLog = [];
let publish = { ok: false, reason: "harvest-secret-missing" };
let statusAfter = statusBefore;

if (!ready.ready) {
  publish = { ok: false, reason: "api-not-ready", http: ready.http, attempt: ready.attempt };
} else if (!SECRET) {
  console.log("nfl_pregame_publish skipped — harvest secret missing");
} else {
  for (let attempt = 1; attempt <= RECONCILE_ATTEMPTS; attempt += 1) {
    let attemptPublish = await postPublish(
      attempt === 1 ? "nfl-pregame-publish-slate" : `nfl-pregame-reconcile-${attempt}`
    );
    // Transport retries for deploy races.
    for (let t = 1; t <= 4 && (attemptPublish.http === 405 || attemptPublish.http === 404); t += 1) {
      await sleep(1500 * t);
      attemptPublish = await postPublish(`nfl-pregame-reconcile-${attempt}-t${t}`);
    }
    if (attemptPublish.http === 403) {
      publish = { http: attemptPublish.http, ...attemptPublish.body, reason: "unauthorized" };
      reconcileLog.push({ attempt, http: 403, ok: false });
      break;
    }
    publish = { http: attemptPublish.http, ...attemptPublish.body };
    statusAfter = await getJson(`${BASE}/api/nfl-pregame-publish?coverage=1${DATE ? `&date=${DATE}` : ""}`);
    const coverage = statusAfter.body?.coverage || publish.coverage || null;
    const gaps = coverageGaps(coverage);
    const share = coverage?.currentCoverageShare;
    reconcileLog.push({
      attempt,
      http: publish.http,
      ok: Boolean(publish.ok),
      inserted: publish.summary?.success ?? null,
      already: publish.summary?.already ?? null,
      coverageShare: share ?? null,
      gapEventIds: gaps.map((g) => g.eventId),
      gapMatchups: gaps.map((g) => g.matchup),
      gapCheckpoints: gaps.map((g) => g.currentCheckpoint),
    });
    console.log(JSON.stringify({ phase: "reconcile", ...reconcileLog[reconcileLog.length - 1] }));
    fs.writeFileSync(path.join(OUT, `nfl-pregame-reconcile-attempt-${attempt}.json`), JSON.stringify({
      publish,
      coverage,
      gaps,
    }, null, 2));

    if (share === 1 || (coverage?.currentEligible > 0 && gaps.length === 0)) {
      break;
    }
    if (attempt < RECONCILE_ATTEMPTS) {
      await sleep(RECONCILE_DELAY_MS * attempt);
    }
  }
}

fs.writeFileSync(path.join(OUT, "nfl-pregame-publish-result.json"), JSON.stringify(publish, null, 2));
fs.writeFileSync(path.join(OUT, "nfl-pregame-coverage-after.json"), JSON.stringify(statusAfter.body, null, 2));
fs.writeFileSync(path.join(OUT, "nfl-pregame-reconcile-log.json"), JSON.stringify(reconcileLog, null, 2));

const coverageAfter = statusAfter.body?.coverage || publish.coverage || null;
const gapsAfter = coverageGaps(coverageAfter);
const summary = {
  generatedAt: new Date().toISOString(),
  publishOk: Boolean(publish.ok) || (coverageAfter?.currentCoverageShare === 1),
  http: publish.http || null,
  apiReady: Boolean(ready.ready),
  liveSha,
  deployWait: shaWait ? { outcome: shaWait.outcome, actualSha: shaWait.actualSha } : null,
  requireDeploySha: REQUIRE_DEPLOY_SHA,
  reconcileAttempts: reconcileLog.length,
  summary: publish.summary || null,
  coverageBefore: statusBefore.body?.coverage || null,
  coverageAfter,
  remainingGaps: gapsAfter.map((g) => ({
    eventId: g.eventId,
    matchup: g.matchup,
    currentCheckpoint: g.currentCheckpoint,
    hoursToStart: g.hoursToStart,
    priorPublications: (g.publications || []).map((p) => p.checkpoint),
  })),
};
fs.writeFileSync(path.join(OUT, "nfl-pregame-publish-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  ok: summary.publishOk,
  inserted: summary.summary?.success ?? null,
  already: summary.summary?.already ?? null,
  blocked: summary.summary?.blocked ?? null,
  coverageShare: coverageAfter?.currentCoverageShare ?? null,
  remainingGaps: summary.remainingGaps.length,
  apiReady: summary.apiReady,
  reconcileAttempts: summary.reconcileAttempts,
}));

const incomplete = (coverageAfter?.currentEligible || 0) > 0
  && (coverageAfter?.currentCoverageShare ?? 0) < 1;
if (STRICT && (!summary.publishOk || incomplete)) process.exit(1);
process.exit(0);
