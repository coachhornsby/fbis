#!/usr/bin/env node
/**
 * Freeze the currently eligible NFL research checkpoint for every slate game.
 * Soft ops script — exits 0 unless --strict is set.
 *
 * Env:
 *   BASE             production origin (default https://fbis-myz.pages.dev)
 *   HARVEST_SECRET   operator write secret (header x-harvest-secret)
 *   ARTIFACT_DIR     output directory
 *   NFL_PUBLISH_DATE optional YYYY-MM-DD
 */
import fs from "node:fs";
import path from "node:path";

const BASE = String(process.env.BASE || "https://fbis-myz.pages.dev").replace(/\/$/, "");
const SECRET = process.env.HARVEST_SECRET || "";
const OUT = process.env.ARTIFACT_DIR || "artifacts";
const DATE = process.env.NFL_PUBLISH_DATE || "";
const STRICT = process.argv.includes("--strict");

fs.mkdirSync(OUT, { recursive: true });

async function getJson(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 800) }; }
  return { http: res.status, body };
}

const statusBefore = await getJson(`${BASE}/api/nfl-pregame-publish?coverage=1${DATE ? `&date=${DATE}` : ""}`);
fs.writeFileSync(path.join(OUT, "nfl-pregame-coverage-before.json"), JSON.stringify(statusBefore.body, null, 2));

let publish = { ok: false, reason: "harvest-secret-missing" };
if (SECRET) {
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
}));

if (STRICT && !summary.publishOk) process.exit(1);
process.exit(0);
