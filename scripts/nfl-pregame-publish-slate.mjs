#!/usr/bin/env node
/**
 * Freeze the currently eligible NFL research checkpoint for every slate game.
 * Soft ops script — exits 0 unless --strict is set.
 *
 * Waits for the production API route to be live (JSON, not SPA HTML / 405)
 * so push-triggered runs do not race Cloudflare Pages deploys.
 *
 * Env:
 *   BASE             production origin (default https://fbis-myz.pages.dev)
 *   HARVEST_SECRET   operator write secret (header x-harvest-secret)
 *   ARTIFACT_DIR     output directory
 *   NFL_PUBLISH_DATE optional YYYY-MM-DD
 *   EXPECTED_SHA     optional 40-char SHA; when set, also wait for /api/health match
 *   READY_ATTEMPTS   readiness poll attempts (default 24)
 */
import fs from "node:fs";
import path from "node:path";
import { verifyDeploymentSha } from "./verify-deployment-sha.mjs";

const BASE = String(process.env.BASE || "https://fbis-myz.pages.dev").replace(/\/$/, "");
const SECRET = process.env.HARVEST_SECRET || "";
const OUT = process.env.ARTIFACT_DIR || "artifacts";
const DATE = process.env.NFL_PUBLISH_DATE || "";
const STRICT = process.argv.includes("--strict");
const EXPECTED_SHA = String(process.env.EXPECTED_SHA || process.env.GITHUB_SHA || "").toLowerCase();
const READY_ATTEMPTS = Math.max(1, Number(process.env.READY_ATTEMPTS || 24) || 24);

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
  // SPA HTML fallback sometimes parse-fails into {raw:"<!DOCTYPE..."}
  if (typeof probe.body.raw === "string" && /<!DOCTYPE html>/i.test(probe.body.raw)) return false;
  return true;
}

async function waitForPublishApi() {
  const coverageUrl = `${BASE}/api/nfl-pregame-publish?coverage=1${DATE ? `&date=${DATE}` : ""}`;
  let last = null;
  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt += 1) {
    last = await getJson(coverageUrl);
    last.attempt = attempt;
    if (apiReady(last)) {
      return { ready: true, ...last };
    }
    const delay = Math.min(15000, 1000 * attempt);
    console.log(JSON.stringify({
      phase: "wait-api",
      attempt,
      http: last.http,
      contentType: last.contentType,
      delayMs: delay,
    }));
    await sleep(delay);
  }
  return { ready: false, ...last };
}

let shaWait = null;
if (/^[0-9a-f]{40}$/.test(EXPECTED_SHA)) {
  shaWait = await verifyDeploymentSha({
    expectedSha: EXPECTED_SHA,
    fetchHealth: async () => {
      const res = await fetch(`${BASE}/api/health?_t=${Date.now()}`);
      const contentType = res.headers.get("content-type") || "";
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      return { status: res.status, contentType, json };
    },
  });
  fs.writeFileSync(path.join(OUT, "nfl-pregame-deploy-wait.json"), JSON.stringify(shaWait, null, 2));
  if (shaWait?.outcome !== "MATCH") {
    console.log(JSON.stringify({ phase: "deploy-wait", outcome: shaWait?.outcome, reason: shaWait?.reason }));
  }
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

let publish = { ok: false, reason: "harvest-secret-missing" };
if (!ready.ready) {
  publish = { ok: false, reason: "api-not-ready", http: ready.http, attempt: ready.attempt };
} else if (SECRET) {
  publish = await getJson(`${BASE}/api/nfl-pregame-publish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-harvest-secret": SECRET,
    },
    body: JSON.stringify({
      date: DATE || undefined,
      publishedBy: "nfl-pregame-publish-slate",
      codeSha: process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || null,
    }),
  });
  // Retry a few times if deploy race still yields 405/HTML after readiness probe.
  for (let attempt = 1; attempt <= 6 && (publish.http === 405 || publish.http === 404 || !publish.body?.ok); attempt += 1) {
    if (publish.body?.ok) break;
    if (publish.http === 403) break; // auth failure — do not retry
    await sleep(2000 * attempt);
    publish = await getJson(`${BASE}/api/nfl-pregame-publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-harvest-secret": SECRET,
      },
      body: JSON.stringify({
        date: DATE || undefined,
        publishedBy: "nfl-pregame-publish-slate",
        codeSha: process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || null,
      }),
    });
  }
  publish = { http: publish.http, ...publish.body };
} else {
  console.log("nfl_pregame_publish skipped — harvest secret missing");
}

fs.writeFileSync(path.join(OUT, "nfl-pregame-publish-result.json"), JSON.stringify(publish, null, 2));

const statusAfter = await getJson(`${BASE}/api/nfl-pregame-publish?coverage=1${DATE ? `&date=${DATE}` : ""}`);
fs.writeFileSync(path.join(OUT, "nfl-pregame-coverage-after.json"), JSON.stringify(statusAfter.body, null, 2));

const summary = {
  generatedAt: new Date().toISOString(),
  publishOk: Boolean(publish.ok),
  http: publish.http || null,
  apiReady: Boolean(ready.ready),
  deployWait: shaWait ? { outcome: shaWait.outcome, actualSha: shaWait.actualSha } : null,
  summary: publish.summary || null,
  coverageBefore: statusBefore.body?.coverage || null,
  coverageAfter: statusAfter.body?.coverage || publish.coverage || null,
};
fs.writeFileSync(path.join(OUT, "nfl-pregame-publish-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  ok: summary.publishOk,
  inserted: summary.summary?.success ?? null,
  already: summary.summary?.already ?? null,
  blocked: summary.summary?.blocked ?? null,
  coverageShare: summary.coverageAfter?.currentCoverageShare ?? null,
  apiReady: summary.apiReady,
}));

if (STRICT && !summary.publishOk) process.exit(1);
process.exit(0);
