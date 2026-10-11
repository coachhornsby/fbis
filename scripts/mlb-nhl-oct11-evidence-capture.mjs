#!/usr/bin/env node
/**
 * FBIS October 11 multi-sport capture: read-only, run-scoped, prospective when actually pregame.
 * All NHL games on the slate plus the MLB postseason game. Never places or qualifies wagers.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const BASE = String(process.env.BASE || "https://fbis-myz.pages.dev").replace(/\/$/, "");
const DATE = "2026-10-11";
const expectedMin = { mlb: 1, nhl: 3 };
const stamp = new Date();
const capturedAt = stamp.toISOString();
const ctDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
}).formatToParts(stamp);
const getPart = kind => ctDate.find(x => x.type === kind)?.value || "";
const todayCt = [getPart("year"), getPart("month"), getPart("day")].join("-");
if (todayCt !== DATE) {
  console.log(JSON.stringify({ skipped: "outside-oct11-chicago-date", todayCt, capturedAt }));
  process.exit(0);
}

const abbr = team => String(typeof team === "string" ? team :
  team?.abbr || team?.abbreviation || team?.shortName || "").toUpperCase();
const nonEmpty = value => value !== undefined && value !== null && value !== "";
const first = (...values) => values.find(nonEmpty) ?? null;
const validNumber = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const numberOrNull = value => validNumber(value) ?? (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null);
const dateMs = value => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};
const market = game => {
  const odds = game.odds || {};
  const pin = game.pin || {};
  const observedAt = first(odds.observedAt, odds.asOf, odds.sourceTimestamp, pin.observedAt);
  const observedMs = dateMs(observedAt);
  const marketObservation = observedMs !== null && observedMs <= stamp.getTime() ? "TIMESTAMPED" : "UNVERIFIED_TIME";
  return {
    bookmaker: first(odds.book, pin.book),
    observedAt, sourceTimestamp: first(odds.sourceTimestamp, pin.sourceTimestamp),
    freshness: first(odds.freshness, pin.freshness),
    observationStatus: marketObservation,
    homeMoneyline: numberOrNull(first(odds.pinHomeMl, odds.homeMl, odds.homeMoneyline, pin.moneyline?.priceA, pin.moneyline?.home)),
    awayMoneyline: numberOrNull(first(odds.pinAwayMl, odds.awayMl, odds.awayMoneyline, pin.moneyline?.priceB, pin.moneyline?.away)),
    spread: numberOrNull(first(odds.pinSpread, odds.spread, pin.spread?.line)),
    total: numberOrNull(first(odds.pinTotal, odds.total, pin.total?.line)),
    spreadHomePrice: numberOrNull(first(odds.pinSpreadHomePrice, pin.spread?.priceA)),
    totalOverPrice: numberOrNull(first(odds.pinOverPrice, pin.total?.priceA)),
  };
};
const projection = game => ({
  modelId: first(game.researchProjection?.modelId, game.projectionEngine, game.model?.id),
  version: first(game.researchProjection?.modelVersion, game.modelVersion, game.model?.version),
  away: numberOrNull(first(game.model?.projAway, game.projAway, game.projAwayScore, game.researchProjection?.away)),
  home: numberOrNull(first(game.model?.projHome, game.projHome, game.projHomeScore, game.researchProjection?.home)),
  total: numberOrNull(first(game.model?.total, game.model?.projTotal, game.researchProjection?.total)),
  homeWinProbability: numberOrNull(first(game.model?.pHomeWin, game.researchProjection?.pHomeWin, game.projection?.homeWinProbability)),
  independent: game.projection?.independent === true || game.researchProjection?.independent === true || game.model?.independent === true,
});
const summarizeGame = (sport, game) => {
  const start = first(game.start, game.startTime, game.dateTime, game.gameState?.start);
  const kickoff = dateMs(start);
  const state = String(first(game.gameState?.state, game.status?.state, game.status, "")).toUpperCase();
  const liveOrFinal = Boolean(game.gameState?.live || game.gameState?.completed || game.status?.live ||
     game.status?.completed || /LIVE|FINAL|COMPLETE|IN_PROGRESS|INPROGRESS/.test(state));
  const classification = kickoff !== null && stamp.getTime() < kickoff && !liveOrFinal
    ? "PROSPECTIVE_PREGAME" : kickoff === null ? "UNKNOWN_START" : "NOT_PREGAME";
  const prices = market(game);
  return {
    sport, gameId: String(first(game.id, game.gameId, "")),
    away: abbr(game.away), home: abbr(game.home),
    capturedAt, start,
    state, classification,
    priceAttributionValid: prices.observationStatus === "TIMESTAMPED" && nonEmpty(prices.bookmaker),
    market: prices, projection: projection(game),
    lineup: first(game.lineupStatus, game.lineups, null),
    goaltenders: sport === "nhl" ? first(game.goalies, game.startingGoalies, null) : null,
    pitchers: sport === "mlb" ? first(game.pitchers, game.probablePitchers, null) : null,
    governance: { researchOnly: true, canQualify: false, canAuthorizeWager: false },
    rawGame: game,
  };
};
const findings = [];
const errors = [];
for (const sport of ["mlb", "nhl"]) {
  const url = `${BASE}/api/today?sport=${sport}&date=${DATE}&_capture=${stamp.getTime()}`;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "cache-control": "no-cache" },
      signal: AbortSignal.timeout(55000),
    });
    if (!response.ok) throw new Error(`http-${response.status}`);
    const body = await response.json();
    const games = body.games || body.slate?.games || body.data?.games;
    if (!Array.isArray(games)) throw new Error("invalid-games-array");
    const rows = games.map(g => summarizeGame(sport, g));
    if (rows.length < expectedMin[sport]) errors.push(`${sport}-coverage-${rows.length}-expected-${expectedMin[sport]}`);
    findings.push({ sport, source: url, capturedAt, expectedMinimum: expectedMin[sport],
      count: rows.length, pregame: rows.filter(g => g.classification === "PROSPECTIVE_PREGAME").length, games: rows });
  } catch (error) {
    errors.push(`${sport}-fetch-${String(error.message || error)}`);
    findings.push({ sport, source: url, capturedAt, count: 0, games: [], error: String(error.message || error) });
  }
}
const packet = {
  schema: "fbis-mlb-nhl-prospective-board-v1", captureDateCt: DATE, capturedAt,
  classificationRule: "PRE-GAME ONLY if capturedAt < scheduled first pitch/puck drop and game is not live/final",
  warning: "Board snapshots are research evidence, not verified frozen raw model inputs. Prices without source timestamps are not CLV/ROI eligible.",
  noModelOrWagerAuthority: true, errors, sports: findings,
};
const output = JSON.stringify(packet);
const sha256 = createHash("sha256").update(output).digest("hex");
const dir = "artifacts/mlb-nhl-oct11";
await mkdir(dir, { recursive: true });
await Promise.all([
  writeFile(`${dir}/capture.json`, output),
  writeFile(`${dir}/sha256.txt`, `${sha256}  capture.json\n`),
  writeFile(`${dir}/summary.json`, JSON.stringify({ capturedAt, sha256, errors,
    sports: findings.map(x => ({ sport: x.sport, count: x.count, pregame: x.pregame,
      games: x.games.map(g => ({ gameId: g.gameId, away: g.away, home: g.home, start: g.start,
        classification: g.classification, modelId: g.projection.modelId,
        marketTimestamp: g.market.observedAt, priceAttributionValid: g.priceAttributionValid })) })) }, null, 2)),
]);
console.log(JSON.stringify({ ok: errors.length === 0, sha256, capturedAt, errors,
  counts: findings.map(x => ({ sport: x.sport, games: x.count, pregame: x.pregame })) }));
if (errors.length) process.exitCode = 2;
