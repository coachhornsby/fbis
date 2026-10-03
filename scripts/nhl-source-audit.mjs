#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import {
  NHL_DATA_SOURCE_POLICY,
  classifyNhlArchiveFreshness,
} from "../functions/lib/nhlDataSources.js";

const out = process.argv.find((x) => x.startsWith("--out="))?.split("=").slice(1).join("=")
  || "artifacts/nhl-source-audit.json";
const date = process.argv.find((x) => x.startsWith("--date="))?.split("=")[1]
  || new Date().toISOString().slice(0, 10);

async function json(url, { timeoutMs = 20000 } = {}) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "FBIS-NHL-source-audit/1.0",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP_${res.status} ${url}`);
  return res.json();
}

const report = {
  generatedAt: new Date().toISOString(),
  date,
  livePrimary: {
    id: NHL_DATA_SOURCE_POLICY.livePrimary.id,
    status: "UNKNOWN",
    scheduleGames: 0,
    teamCount: 0,
    errors: [],
  },
  sportsDataverse: {
    id: NHL_DATA_SOURCE_POLICY.historicalArchive.id,
    role: NHL_DATA_SOURCE_POLICY.historicalArchive.role,
    status: "UNKNOWN",
    releases: [],
    staleTags: [],
    errors: [],
  },
  overall: "UNKNOWN",
};

try {
  const [schedule, teams] = await Promise.all([
    json(`https://api-web.nhle.com/v1/schedule/${date}`),
    json("https://api.nhle.com/stats/rest/en/team?limit=-1"),
  ]);
  const scheduleGames = (schedule?.gameWeek || []).reduce((n, d) => n + (d?.games?.length || 0), 0);
  const teamCount = Array.isArray(teams?.data) ? teams.data.length : 0;
  report.livePrimary.scheduleGames = scheduleGames;
  report.livePrimary.teamCount = teamCount;
  report.livePrimary.status = Array.isArray(schedule?.gameWeek) && teamCount >= 30 ? "HEALTHY" : "DEGRADED";
} catch (err) {
  report.livePrimary.status = "FAILED";
  report.livePrimary.errors.push(String(err?.message || err));
}

for (const tag of NHL_DATA_SOURCE_POLICY.historicalArchive.releaseTags) {
  try {
    const rel = await json(`https://api.github.com/repos/${NHL_DATA_SOURCE_POLICY.historicalArchive.repository}/releases/tags/${tag}`);
    const updatedAt = rel?.published_at || rel?.created_at || null;
    const freshness = classifyNhlArchiveFreshness(updatedAt, new Date(`${date}T23:59:59Z`));
    const assets = Array.isArray(rel?.assets) ? rel.assets : [];
    const row = {
      tag,
      updatedAt,
      assetCount: assets.length,
      totalBytes: assets.reduce((n, a) => n + Number(a?.size || 0), 0),
      freshness,
    };
    report.sportsDataverse.releases.push(row);
    if (freshness.stale) report.sportsDataverse.staleTags.push(tag);
  } catch (err) {
    report.sportsDataverse.errors.push({ tag, error: String(err?.message || err) });
  }
}

const releaseCount = report.sportsDataverse.releases.length;
report.sportsDataverse.status = report.sportsDataverse.errors.length
  ? "DEGRADED"
  : report.sportsDataverse.staleTags.length
    ? "DEGRADED_STALE"
    : releaseCount === NHL_DATA_SOURCE_POLICY.historicalArchive.releaseTags.length
      ? "HEALTHY"
      : "DEGRADED";

report.overall = report.livePrimary.status === "HEALTHY"
  ? (report.sportsDataverse.status === "HEALTHY" ? "HEALTHY" : "LIVE_HEALTHY_ARCHIVE_DEGRADED")
  : "FAILED_LIVE_PRIMARY";

await mkdir(out.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report, null, 2));

if (report.livePrimary.status !== "HEALTHY") process.exitCode = 2;
