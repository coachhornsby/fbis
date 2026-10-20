#!/usr/bin/env node
/**
 * Read-only opening-week readiness probe for NBA (default Oct 20–24 CT window).
 * Compares ESPN scoreboard identity against optional production board + D1 counts
 * when credentials are present. Never authorizes wagers.
 */
import fs from "node:fs";
import {
  nbaForwardDates,
  parseNbaDateArgs,
} from "../functions/lib/nbaForwardSlate.js";

const args = Object.fromEntries(process.argv.slice(2).map((x) => x.split("=")));
const start = args.start || "2026-10-20";
const end = args.end || "2026-10-24";
const dates = parseNbaDateArgs({ dates: args.dates })?.length
  ? parseNbaDateArgs({ dates: args.dates })
  : (() => {
      const out = [];
      let cur = start;
      while (cur <= end) {
        out.push(cur);
        const [y, m, d] = cur.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d + 1));
        cur = dt.toISOString().slice(0, 10);
      }
      return out;
    })();
const boardBase = args.boardBase || process.env.FBIS_BOARD_BASE || "https://fbis-myz.pages.dev";
const out = args.out || "artifacts/nba-opening-night-readiness.json";

async function espnDay(date) {
  const stamp = date.replaceAll("-", "");
  const r = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${stamp}&limit=100`,
    { headers: { "user-agent": "FBIS-NBA-Readiness/1.0", accept: "application/json" } }
  );
  if (!r.ok) throw new Error(`ESPN ${date} HTTP ${r.status}`);
  const j = await r.json();
  return (j.events || []).map((ev) => {
    const c = ev.competitions?.[0];
    const cs = c?.competitors || [];
    const h = cs.find((x) => x.homeAway === "home");
    const a = cs.find((x) => x.homeAway === "away");
    return {
      id: String(ev.id),
      start: ev.date || null,
      home: h?.team?.abbreviation || null,
      away: a?.team?.abbreviation || null,
      status: ev.status?.type?.name || null,
      venue: c?.venue?.fullName || null,
    };
  });
}

async function boardDay(date) {
  try {
    const r = await fetch(`${boardBase}/api/today?sport=nba&date=${date}`, {
      headers: { accept: "application/json", "user-agent": "FBIS-NBA-Readiness/1.0" },
    });
    if (!r.ok) return { ok: false, status: r.status, games: [], research: null };
    const j = await r.json();
    const games = Array.isArray(j.games) ? j.games : [];
    return {
      ok: true,
      research: j.research || null,
      games: games.map((g) => ({
        id: String(g.id),
        projectionKind: g.projectionKind || null,
        hasNbaFbisV1: Boolean(g.nbaFbisV1?.ok),
        blocker: g.nbaProjectionBlocker?.code || null,
        canAuthorize: Boolean(g.canAuthorizeWager || g.nbaFbisV1?.canAuthorize),
        home: g.home?.abbr || g.homeAbbr || null,
        away: g.away?.abbr || g.awayAbbr || null,
        modelHome: g.nbaFbisV1?.home ?? null,
        modelAway: g.nbaFbisV1?.away ?? null,
        injuryConfigured: Boolean(g.nbaAvailability?.configured || g.availabilityImpact?.configured),
        outCount: g.nbaAvailability?.outCount ?? null,
        lineupConfirmed: Boolean(g.nbaLineups?.confirmed),
        propsState: g.playerProjectionStatus?.state || null,
        propsRows: Array.isArray(g.playerProjectionRows) ? g.playerProjectionRows.length : 0,
      })),
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), games: [], research: null };
  }
}

async function gateStatus() {
  try {
    const r = await fetch(`${boardBase}/api/nba-prospective-gate`, {
      headers: { accept: "application/json", "user-agent": "FBIS-NBA-Readiness/1.0" },
    });
    if (!r.ok) return { ok: false, status: r.status };
    return await r.json();
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

const days = [];
let espnTotal = 0;
let boardTotal = 0;
let withV1 = 0;
let unauthorized = 0;
let injuryHydrated = 0;
let lineupHydrated = 0;
let propsActive = 0;
const gaps = [];
let researchSummary = null;

const gate = await gateStatus();

for (const date of dates) {
  const espn = await espnDay(date);
  const board = await boardDay(date);
  if (!researchSummary && board.research) researchSummary = board.research;
  const espnIds = new Set(espn.map((g) => g.id));
  const boardIds = new Set(board.games.map((g) => g.id));
  const missingOnBoard = [...espnIds].filter((id) => !boardIds.has(id));
  const extrasOnBoard = [...boardIds].filter((id) => !espnIds.has(id));
  const v1 = board.games.filter((g) => g.hasNbaFbisV1);
  const authLeak = board.games.filter((g) => g.canAuthorize);
  const injury = board.games.filter((g) => g.injuryConfigured);
  const lineups = board.games.filter((g) => g.lineupConfirmed);
  const props = board.games.filter((g) => g.propsState === "ACTIVE_RESEARCH" || g.propsRows > 0);
  espnTotal += espn.length;
  boardTotal += board.games.length;
  withV1 += v1.length;
  unauthorized += authLeak.length;
  injuryHydrated += injury.length;
  lineupHydrated += lineups.length;
  propsActive += props.length;
  if (missingOnBoard.length || extrasOnBoard.length || v1.length < espn.length) {
    gaps.push({ date, missingOnBoard, extrasOnBoard, espn: espn.length, boardV1: v1.length });
  }
  days.push({
    date,
    espnCount: espn.length,
    boardOk: board.ok,
    boardCount: board.games.length,
    boardV1Count: v1.length,
    injuryHydrated: injury.length,
    lineupHydrated: lineups.length,
    propsActive: props.length,
    missingOnBoard,
    extrasOnBoard,
    wagerAuthLeaks: authLeak.map((g) => g.id),
    espn,
    boardGames: board.games,
  });
}

const gateFrozenOk = !gate?.gate?.canAuthorize;
const report = {
  ok: gaps.every((g) => !g.missingOnBoard.length && !g.extrasOnBoard.length) && withV1 === espnTotal && unauthorized === 0 && gateFrozenOk,
  generatedAt: new Date().toISOString(),
  window: { start: dates[0], end: dates.at(-1), dates },
  boardBase,
  totals: {
    espnGames: espnTotal,
    boardGames: boardTotal,
    withNbaFbisV1: withV1,
    wagerAuthLeaks: unauthorized,
    injuryHydrated,
    lineupHydrated,
    propsActive,
    forwardCollectDays: 4,
    forwardShadowDays: 6,
    sampleForwardDates: nbaForwardDates(dates[0] || start, 4),
  },
  gaps,
  prospectiveGate: {
    ok: Boolean(gate?.ok),
    status: gate?.gate?.status || null,
    progress: gate?.gate?.progress || null,
    gaps: gate?.gate?.gaps || null,
    criteriaReady: gate?.gate?.criteriaReady || false,
    awaitingOperator: gate?.gate?.awaitingOperator || false,
    canAuthorize: Boolean(gate?.gate?.canAuthorize),
    nextStep: gate?.nextStep || null,
  },
  boardResearch: {
    nbaProspectiveGate: researchSummary?.nbaProspectiveGate || null,
    nbaAvailability: researchSummary?.nbaAvailability || null,
    nbaPlayerProjection: researchSummary?.nbaPlayerProjection || null,
  },
  governance: {
    canAuthorizeWager: Boolean(gate?.gate?.canAuthorize),
    prospectiveGate: gate?.gate?.status || "FROZEN_RESEARCH_GATE",
    note: "Displaying an independent projection is not wagering authority. Unfreeze requires criteria + D1 operator cutover.",
  },
  days,
};

fs.mkdirSync(out.split("/").slice(0, -1).join("/") || ".", { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      ok: report.ok,
      out,
      totals: report.totals,
      gapDays: gaps.length,
      wagerAuthLeaks: unauthorized,
      gateStatus: report.prospectiveGate.status,
      gateProgress: report.prospectiveGate.progress,
      injuryHydrated,
      lineupHydrated,
      propsActive,
    },
    null,
    2
  )
);
process.exitCode = report.ok ? 0 : 2;
