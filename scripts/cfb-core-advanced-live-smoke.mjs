#!/usr/bin/env node
/**
 * Live (or fixture) smoke for week-aware CORE + advanced plumbing.
 * Uses CFBD_API_KEY when present; otherwise validates offline fixtures.
 * Research-only — does not write production D1 or authorize wagers.
 *
 *   node scripts/cfb-core-advanced-live-smoke.mjs [--week 8] [--season 2026]
 */
import { indexCfbRatings } from "../functions/lib/collegeJobsCore.js";
import {
  estimateCfbWeekFromDate,
  coreThroughWeekBound,
  enrichCatalogWithCoreProvenance,
  indexAdvancedGameRows,
  indexPpaGameRows,
  indexPlayerSeasonRoles,
} from "../functions/lib/cfbCoreAdvancedPlumbing.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const season = Number(args.season) || 2026;
const week = Number(args.week) || estimateCfbWeekFromDate(new Date(), season);
const throughWeek = coreThroughWeekBound(week);
const key = process.env.CFBD_API_KEY || "";
const BASE = "https://api.collegefootballdata.com";

async function get(path, query = {}) {
  if (!key) return { ok: false, data: [], skipped: "no-key" };
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const remaining = res.headers.get("X-CallLimit-Remaining");
  if (!res.ok) return { ok: false, status: res.status, data: [], remaining };
  return { ok: true, status: res.status, data: await res.json(), remaining };
}

const fixtureCore = [
  {
    team: "Ohio State",
    rating: 22.5,
    throughWeek: Math.max(1, throughWeek || 1),
    throughSeasonType: "regular",
    offense: { rating: 18 },
    defense: { rating: -4 },
  },
];

let core = { ok: false, data: fixtureCore, remaining: null };
let ppaTeams = { ok: false, data: [] };
let advSeason = { ok: false, data: [] };
let ppaGames = { ok: false, data: [] };
let advGames = { ok: false, data: [] };
let qb = { ok: false, data: [] };
let usage = { ok: false, data: [] };

if (key) {
  console.error(JSON.stringify({ phase: "live-fetch", season, week, throughWeek }));
  [core, ppaTeams, advSeason] = await Promise.all([
    get("/ratings/core", { year: season }),
    get("/ppa/teams", { year: season, seasonType: "regular" }),
    get("/stats/season/advanced", { year: season }),
  ]);
  if (throughWeek >= 1) {
    [ppaGames, advGames] = await Promise.all([
      get("/ppa/games", { year: season, week: throughWeek, seasonType: "regular" }),
      get("/stats/game/advanced", { year: season, week: throughWeek, seasonType: "regular" }),
    ]);
  }
  [qb, usage] = await Promise.all([
    get("/ppa/players/season", { year: season, position: "QB" }),
    get("/player/usage", { year: season }),
  ]);
} else {
  console.error(JSON.stringify({ phase: "fixture-mode", season, week, throughWeek }));
}

const catalog = enrichCatalogWithCoreProvenance(
  indexCfbRatings({
    "/ratings/core": core.data || [],
    "/ppa/teams": ppaTeams.data || [],
    "/stats/season/advanced": advSeason.data || [],
  }),
  core.data || [],
  { maxWeek: throughWeek, seasonType: "regular" }
);

const players = indexPlayerSeasonRoles({
  qbRows: qb.data || [],
  usageRows: usage.data || [],
});

const report = {
  ok: true,
  mode: key ? "live" : "fixture",
  season,
  week,
  throughWeek,
  providerRemaining: core.remaining ?? ppaTeams.remaining ?? null,
  teams: catalog.n,
  coreEnriched: catalog.coreEnriched,
  coreIndexed: catalog.coreIndexed,
  coreScrubbed: catalog.coreScrubbed,
  ppaGames: indexPpaGameRows(ppaGames.data || []).n,
  advGames: indexAdvancedGameRows(advGames.data || []).n,
  players: players.n,
  sample: Object.values(catalog.byCanonicalId || {})
    .slice(0, 3)
    .map((r) => ({
      team: r.team,
      core: r.core ?? null,
      coreThroughWeek: r.coreThroughWeek ?? null,
      coreWeekBounded: r.coreWeekBounded ?? null,
      ppaOff: r.ppaOff ?? null,
      offensiveSuccessRate: r.offensiveSuccessRate ?? null,
    })),
  authority: "research_only",
  canAuthorizeWager: false,
  canInfluenceProjection: false,
};

if (catalog.n < 1) {
  console.error(JSON.stringify({ ok: false, reason: "NO_TEAMS_INDEXED", report }));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
