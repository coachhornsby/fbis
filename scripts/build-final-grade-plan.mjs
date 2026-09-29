#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolveFinalForSnapshot } from "../functions/lib/projLedger.js";

const [reportPath, scoreboardPath, sportArg, dateArg] = process.argv.slice(2);
const sport = String(sportArg || "").toLowerCase();
const date = String(dateArg || "").slice(0, 10);
if (!reportPath || !scoreboardPath || !sport || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("usage: node scripts/build-final-grade-plan.mjs <learning-report.json> <scoreboard.json> <sport> <YYYY-MM-DD>");
  process.exit(2);
}

function ctDate(iso) {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const report = JSON.parse(await readFile(reportPath, "utf8"));
const scoreboard = JSON.parse(await readFile(scoreboardPath, "utf8"));
const finals = Array.isArray(scoreboard?.finals) ? scoreboard.finals : [];
const audit = Array.isArray(report?.audit) ? report.audit : [];
const forceRepair = process.env.FORCE_REPAIR === "1";

const byGame = new Map();
for (const row of audit) {
  if (!forceRepair && String(row?.learningStatus || "").toUpperCase() !== "AWAITING FINAL") continue;
  if (String(row?.sport || "").toLowerCase() !== sport) continue;
  const gameDate = row?.start ? ctDate(row.start) : String(row?.date || "").slice(0, 10);
  if (gameDate !== date) continue;
  const gameId = String(row?.gameId || row?.id || "").trim();
  if (!gameId || byGame.has(gameId)) continue;
  byGame.set(gameId, row);
}

const grades = [];
const unmatchedGameIds = [];
for (const [gameId, row] of byGame.entries()) {
  const hit = resolveFinalForSnapshot(row, finals);
  if (!hit) {
    unmatchedGameIds.push(gameId);
    continue;
  }
  const actualHome = finite(hit?.home?.score ?? hit?.actualHome);
  const actualAway = finite(hit?.away?.score ?? hit?.actualAway);
  if (actualHome == null || actualAway == null) {
    unmatchedGameIds.push(gameId);
    continue;
  }
  grades.push({
    gameId,
    actualHome,
    actualAway,
    f5ActualHome: hit?.f5Score?.complete ? finite(hit.f5Score.home) : null,
    f5ActualAway: hit?.f5Score?.complete ? finite(hit.f5Score.away) : null,
  });
}

process.stdout.write(JSON.stringify({
  ok: true,
  sport,
  date,
  source: scoreboard?.source || "trusted-scoreboard",
  candidates: byGame.size,
  grades,
  unmatchedGameIds,
  forceRepair,
  generatedAt: new Date().toISOString(),
}));
