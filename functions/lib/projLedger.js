/**
 * Frozen projection ledger. Snapshot pregame scores, then grade vs finals.
 * Harvest uses scoreboards only — never Parlay — so nightly grading is free.
 */

import { readCache, writeCache } from "./cache.js";
import { namesMatch } from "./parlay.js";
import { BOARD_SPORTS, SPORTS, lastNDatesCT, todayCT, shiftDateCT, fetchResults, blendWinProb, buildSlate, recommendBundle } from "./slateEngine.js";
import { DEFAULT_WEIGHTS, MODEL_VERSION } from "./weights.js";
import { brierScore, logLoss } from "./pricing.js";
import {
  persistGame,
  persistOddsSnapshot,
  persistPrediction,
  persistSnapshot,
  persistDailyMetrics,
  persistDailyReport,
  queryDailyMetrics,
  pingDb,
  querySnapshots,
  queryPredictions,
  queryVersions,
  queryDailyReports,
  countToday,
  researchHealth,
  setMeta,
  readMeta,
  applyFinalToForm,
  persistStrategy,
  persistStrategyTicket,
  queryStrategyTickets,
  gradeStrategyTicket,
  hasDb,
  enqueueHarvestRetry,
  resolveHarvestRetry,
  queryOddsSnapshots,
  gradeSnapshotsForGame,
  queryExecutedBets,
  updateExecutedBet,
  persistMlbMarketProjections,
} from "./store.js";
import { classifyCheckpoint, materiallyChanged, pickCanonical, snapshotKey, CHECKPOINTS, rowsForCheckpoint } from "./checkpoints.js";
import { buildAccuracyPack } from "./accuracyReport.js";
import { overDiagnostics } from "./overDiagnostics.js";
import { buildDailyReport } from "./dailyReport.js";
import { median, rmse, withinBands } from "./metrics.js";
import { cfbSeasonYear } from "./cfbModel.js";
import { STRATEGY_HC_V1, ticketMatchesStrategy, packTicket, gradeStrategyResult, strategyStats } from "./strategy.js";
import { packPinOddsRows, isPostStart, clvTracker, closeCoverage } from "./closeCapture.js";
import { settleExecutedBet } from "./executedBets.js";
import { sourceCoverage, palHealth } from "./sourceCoverage.js";
import { palUnavailableReason, palHttpStatusToStore } from "./ballparkpal.js";
import { layerDiagnostics } from "./layerDiagnostics.js";
import { resolveTeam } from "./teams.js";
import {
  classifyJobStatus,
  emptyWriteCounts,
  jobPayload,
  mergeWriteCounts,
  recordJob,
  stampAttempt,
  stampSuccess,
  durableHealth,
  staleScheduleWarning,
  scheduledHealth,
  deploymentCommit,
  JOB_SUCCESS,
  JOB_FAILED,
} from "./jobs.js";
import { persistGameChallengers, gradeGameChallengers } from "./collegeJobs.js";
import { queryQuota } from "./collegeStore.js";
import { storageBudget } from "./storageBudget.js";
import { collegeKeyHealth } from "./collegeSecrets.js";

const TTL_MS = 21 * 24 * 60 * 60 * 1000;
const HARVEST_TTL_MS = 10 * 60 * 1000;
const CACHE_VER = "proj-v3";
const KEEP_DAYS = 21;

export const RECIPE_GUIDE = {
  mlb: {
    engine: "Baseball Savant (Pal overlay when keyed)",
    body: "Two independent MLB models. Proprietary: Savant RPG × starter ERA-eq × 1.04 home, clamped 2.3–7.2. Ballpark Pal: simulated runs and Pal win probability as a separate layer — Pal never overwrites Savant and is never a sportsbook price. Scheduled collection writes checkpoints to D1 even if the board is closed.",
  },
  nba: {
    engine: "Pinnacle line-implied",
    body: "Home = total/2 − home spread/2. Away = total/2 + home spread/2. That is the market’s implied score until an independent NBA sim is wired. Win-prob blends Pinnacle no-vig, ESPN, score (line-implied margin), and W-L form.",
  },
  nfl: {
    engine: "Pinnacle implied score (no independent FBIS NFL model)",
    body: "PINNACLE IMPLIED SCORE is total/2 ± spread/2. That is market context, not an independent FBIS projection. Circular market-derived scores cannot qualify. Identity/logos use the canonical NFL registry.",
  },
  cfb: {
    engine: "CFB prior-v2-cfbd + season evidence",
    body: "Champion: CollegeFootballData SP+/FPI/SRS/Elo covering all FBS (cfb-prior-v2-cfbd) blended with harvested points for/against, w = n/(n+6). HFA 2.5 (0 on confirmed neutral). Shadow challengers (CFB-LEAGUE-BASELINE, CFB-CFBD-RATINGS-v1, CFB-CFBD-REG-v1, ensemble, Pinnacle-implied, HFA) cannot QUALIFY, LOG, or write strategy tickets. League-average-only remains diagnostic. Pal is never a book.",
  },
  cbb: {
    engine: "Pinnacle line-implied champion; CBBD ratings are shadow",
    body: "Champion remains Pinnacle total/spread split until a CBB challenger is promoted. CBB-CBBD-RATINGS-v1 and related models are versioned shadow challengers (correct AdjOE×opp AdjDE / national × possessions). They cannot QUALIFY, LOG, or write strategy tickets. KenPom is not required. Torvik is optional cached-only.",
  },
};

export function windowStart(days, sport = "mlb") {
  if (days === "lifetime") return "2000-01-01";
  if (days === "season") {
    const today = todayCT();
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    if (sport === "nba" || sport === "cbb") return m >= 10 ? `${y}-10-01` : `${y - 1}-10-01`;
    if (sport === "nfl" || sport === "cfb") return m >= 8 ? `${y}-08-01` : `${y - 1}-08-01`;
    return m >= 3 ? `${y}-03-01` : `${y - 1}-03-01`;
  }
  const n = Math.max(1, Number(days) || 30);
  return lastNDatesCT(n).at(-1);
}

function ledgerKey(sport) {
  return `${CACHE_VER}:ledger:${sport}`;
}

function rowKey(date, id) {
  return `${date}:${id}`;
}

function mean(xs) {
  return xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null;
}

function prune(games, today = todayCT()) {
  const cutoff = lastNDatesCT(KEEP_DAYS, today).at(-1);
  const next = {};
  for (const [k, row] of Object.entries(games || {})) {
    if (!row?.date || row.date >= cutoff) next[k] = row;
  }
  return next;
}

async function loadLedger(sport, cfCache) {
  const data = await readCache(ledgerKey(sport), cfCache, TTL_MS);
  return { games: data?.games || {} };
}

async function saveLedger(sport, ledger, cfCache) {
  const payload = { games: prune(ledger.games), savedAt: new Date().toISOString() };
  await writeCache(ledgerKey(sport), payload, cfCache, TTL_MS);
  return payload;
}

function snapshotOdds(game) {
  const pin = game.pin || {};
  return {
    at: new Date().toISOString(),
    pinHomeMl: game.odds?.pinHomeMl ?? game.fairHomeMl ?? null,
    pinAwayMl: game.odds?.pinAwayMl ?? game.fairAwayMl ?? null,
    pinSpreadHomePrice: game.odds?.pinSpreadHomePrice ?? null,
    pinSpreadAwayPrice: game.odds?.pinSpreadAwayPrice ?? null,
    pinOverPrice: game.odds?.pinOverPrice ?? null,
    pinUnderPrice: game.odds?.pinUnderPrice ?? null,
    noVigHome: pin.ml?.noVigA ?? null,
    noVigAway: pin.ml?.noVigB ?? null,
    noVigSpreadHome: pin.spread?.noVigA ?? null,
    noVigSpreadAway: pin.spread?.noVigB ?? null,
    noVigOver: pin.total?.noVigA ?? null,
    noVigUnder: pin.total?.noVigB ?? null,
  };
}

export function freezeFromGame(date, game, weights = DEFAULT_WEIGHTS) {
  const model = game.model || {};
  const recipe = model.recipe || {};
  const projHome = model.projHome ?? game.projHomeScore;
  const projAway = model.projAway ?? game.projAwayScore;
  const palHome = model.palHome ?? game.bpp?.homeRuns ?? null;
  const palAway = model.palAway ?? game.bpp?.awayRuns ?? null;
  if (projHome == null && palHome == null) return null;
  const w = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  const pHomeFinal = model.pHomeFinal ?? blendWinProb(model.layers || {}, w);
  const snap = snapshotOdds(game);
  const checkpoint = classifyCheckpoint(game);
  return {
    id: String(game.id),
    sport: game.sport,
    date,
    matchup: `${game.away?.school || game.away?.abbr || "A"} @ ${game.home?.school || game.home?.abbr || "H"}`,
    awayAbbr: game.away?.abbr,
    homeAbbr: game.home?.abbr,
    awayName: game.away?.name,
    homeName: game.home?.name,
    start: game.start,
    checkpoint,
    projAway,
    projHome,
    projTotal: projHome != null && projAway != null ? projAway + projHome : null,
    projMargin: projHome != null && projAway != null ? projHome - projAway : null,
    palHome,
    palAway,
    palTotal: palHome != null && palAway != null ? palHome + palAway : null,
    palMargin: palHome != null && palAway != null ? palHome - palAway : null,
    engine: recipe.engine || "unknown",
    projectionState: game.cfb?.projectionState || game.projectionState || null,
    projectionKind: game.projectionKind || game.model?.projectionKind || null,
    bettingAllowed: game.cfb?.bettingAllowed ?? null,
    priorVersion: game.cfb?.priorVersion || null,
    steps: recipe.steps || [],
    impliedHome: model.impliedHome ?? null,
    pHome: pHomeFinal,
    pHomeFinal,
    pAwayFinal: pHomeFinal != null ? 1 - pHomeFinal : null,
    pMarket: model.layers?.market ?? null,
    pEspn: model.layers?.espn ?? null,
    pScore: model.layers?.score ?? null,
    pForm: model.layers?.form ?? null,
    pPal: model.layers?.pal ?? null,
    layers: { ...(model.layers || {}) },
    weights: w,
    pinHomeMl: snap.pinHomeMl,
    pinAwayMl: snap.pinAwayMl,
    pinVig: game.pin?.ml?.vig ?? null,
    entryNoVigHome: snap.noVigHome,
    closeNoVigHome: null,
    closePinHomeMl: null,
    closePinAwayMl: null,
    snapshots: [snap],
    dataQuality: game.quality?.score ?? null,
    qualityFlags: [...new Set([
      ...(game.quality?.flags || []),
      ...(palHome == null && palAway == null ? ["missing_pal"] : []),
      ...(game.odds?.pinTotal == null && game.odds?.pinOverPrice == null ? ["missing_pin_total"] : []),
      ...(game.odds?.pinSpread == null && game.odds?.pinSpreadHomePrice == null ? ["missing_pin_spread"] : []),
    ])],
    modelVersion: game.modelVersion || MODEL_VERSION,
    frozenAt: new Date().toISOString(),
    actualAway: null,
    actualHome: null,
    actualTotal: null,
    gradedAt: null,
    f5Proj: game.bpp?.f5?.total ?? null,
    f5Away: game.bpp?.f5?.awayRuns ?? null,
    f5Home: game.bpp?.f5?.homeRuns ?? null,
    palAsOf: game.bpp?.asOf ?? null,
    palRequestId: game.bpp?.requestId ?? null,
    palPHomeStored: game.bpp?.pHome ?? null,
    lineupsOfficial: Boolean(game.bpp?.lineupsOfficial),
    park: game.venue || game.park?.name || "",
    homeSp: game.homeSp?.name || game.homeSp?.last || null,
    awaySp: game.awaySp?.name || game.awaySp?.last || null,
    f5HomeWin: game.bpp?.f5?.homeWin ?? null,
    f5AwayWin: game.bpp?.f5?.awayWin ?? null,
    f5ActualAway: null,
    f5ActualHome: null,
    palRunLine: game.bpp?.runLine ?? null,
    palPark: game.bpp?.park || null,
    palMatchup: game.bpp?.matchup || null,
    palTotals: game.bpp?.totals || null,
    palTeamTotals: game.bpp?.teamTotals || [],
    palProps: game.bpp?.props || [],
    palUnknownMarkets: game.bpp?.unknownMarkets || [],
    sportsbookProps: game.odds?.playerProps || [],
    season: seasonOf(date, game.sport),
    pinSpread: game.odds?.pinSpread ?? null,
    pinTotal: game.odds?.pinTotal ?? null,
    noVigHome: snap.noVigHome,
    noVigAway: snap.noVigAway,
    noVigOver: snap.noVigOver,
    noVigUnder: snap.noVigUnder,
    pOver: model.pOver ?? null,
    pSpreadHome: model.pSpreadHome ?? null,
    marketAt: snap.at,
    marketProjHome: model.marketProjHome ?? game.marketProjHome ?? null,
    marketProjAway: model.marketProjAway ?? game.marketProjAway ?? null,
    week: game.week ?? null,
    conference: game.conference || game.home?.conference || null,
    uncertainty: game.cfb
      ? {
          sigmaMargin: game.cfb.sigmaMargin,
          sigmaTotal: game.cfb.sigmaTotal,
          maturity: game.cfb.maturity,
          flags: game.cfb.flags,
          hfa: game.cfb.hfa,
          homeRank: game.cfb.homeEst?.rank ?? null,
          awayRank: game.cfb.awayEst?.rank ?? null,
          homeFormN: game.cfb.homeEst?.n ?? null,
          awayFormN: game.cfb.awayEst?.n ?? null,
          homeW: game.cfb.homeEst?.w ?? null,
          awayW: game.cfb.awayEst?.w ?? null,
          homePriorOff: game.cfb.homeEst?.priorOff ?? null,
          awayPriorOff: game.cfb.awayEst?.priorOff ?? null,
          homePriorFrozen: game.cfb.homeEst?.priorFrozen || null,
          awayPriorFrozen: game.cfb.awayEst?.priorFrozen || null,
          projectionState: game.cfb.projectionState,
          bettingAllowed: game.cfb.bettingAllowed,
          priorVersion: game.cfb.priorVersion,
          shadowHfa: game.cfb.shadowHfa || null,
          venue: game.cfb.venue || null,
        }
      : null,
    gameStatus: gameOutcome(game),
    espnIdHome: game.home?.espnId || null,
    espnIdAway: game.away?.espnId || null,
  };
}

function marketRowId(parts) {
  return parts.map((v) => String(v ?? "").replace(/[^a-z0-9_.+-]+/gi, "-")).join(":");
}

export function palMarketRowsFromGame(date, game, frozen = freezeFromGame(date, game)) {
  if (!frozen || game?.sport !== "mlb" || (!game?.bpp && !game?.odds?.playerProps?.length)) return [];
  const base = {
    gameId: String(game.id), date, checkpoint: frozen.checkpoint, source: "ballpark-pal",
    sourceAsOf: game.bpp?.asOf || frozen.palAsOf, sourceRequestId: game.bpp?.requestId || frozen.palRequestId,
    modelVersion: frozen.modelVersion, lineupsOfficial: game.bpp?.lineupsOfficial,
    frozenAt: frozen.frozenAt,
  };
  const rows = [];
  const f5Book = game.odds?.f5 || null;
  const f5 = game.bpp?.f5 || null;
  if (f5) {
    const mlPriced = f5Book?.homeMl != null && f5Book?.awayMl != null;
    rows.push({ ...base, id: marketRowId([date, game.id, frozen.checkpoint, "F5_ML"]), period: "F5", marketType: "F5_ML", subjectType: "game",
      projectedHome: f5.homeRuns, projectedAway: f5.awayRuns, pHome: f5.homeWin, pAway: f5.awayWin,
      book: f5Book?.book || null, priced: mlPriced, qualificationState: mlPriced ? "PRICED_CANDIDATE" : "MODEL_LEAN",
      qualificationReason: mlPriced ? null : "missing complete two-way F5 ML price" });
    const totalPriced = f5Book?.total != null && f5Book?.overPrice != null && f5Book?.underPrice != null;
    rows.push({ ...base, id: marketRowId([date, game.id, frozen.checkpoint, "F5_TOTAL", f5Book?.total]), period: "F5", marketType: "F5_TOTAL", subjectType: "game",
      average: f5.total, book: f5Book?.book || null, bookLine: f5Book?.total ?? null, bookOverPrice: f5Book?.overPrice ?? null,
      bookUnderPrice: f5Book?.underPrice ?? null, priced: totalPriced, qualificationState: totalPriced ? "PRICED_CANDIDATE" : "MODEL_LEAN",
      qualificationReason: totalPriced ? null : "missing complete two-way F5 total price" });
    const spreadPriced = f5Book?.spread != null && f5Book?.spreadHomePrice != null && f5Book?.spreadAwayPrice != null;
    if (f5Book?.spread != null || spreadPriced) rows.push({ ...base, id: marketRowId([date, game.id, frozen.checkpoint, "F5_SPREAD", f5Book?.spread]), period: "F5", marketType: "F5_SPREAD", subjectType: "game",
      book: f5Book?.book || null, bookLine: f5Book?.spread ?? null, bookOverPrice: f5Book?.spreadHomePrice ?? null, bookUnderPrice: f5Book?.spreadAwayPrice ?? null,
      priced: spreadPriced, qualificationState: spreadPriced ? "PRICED_CANDIDATE" : "MODEL_LEAN",
      qualificationReason: spreadPriced ? null : "missing complete two-way F5 spread price" });
  }
  for (const p of game.bpp?.props || []) {
    rows.push({ ...base,
      id: marketRowId([date, game.id, frozen.checkpoint, "PROP", p.marketId, p.playerId, p.line]),
      period: "FULL_GAME", marketType: `PLAYER_PROP:${p.marketId || "UNKNOWN"}`, subjectType: "player",
      subjectId: p.playerId, subjectName: p.playerName, teamId: p.teamId, line: p.line,
      pOver: p.over, pUnder: p.under, average: p.average, sourceMarketKey: p.marketId,
      sourceMarketName: p.displayName, priced: false, qualificationState: "PROP_WATCH",
      qualificationReason: "Pal projection only; exact sportsbook line and two-way price unavailable",
    });
  }
  for (const t of game.bpp?.teamTotals || []) {
    rows.push({ ...base,
      id: marketRowId([date, game.id, frozen.checkpoint, "TEAM_TOTAL", t.teamId, t.line]),
      period: "FULL_GAME", marketType: "TEAM_TOTAL", subjectType: "team", subjectId: t.teamId,
      teamId: t.teamId, line: t.line, pOver: t.over, pUnder: t.under, average: t.average,
      sourceMarketKey: t.marketId, sourceMarketName: t.displayName, priced: false,
      qualificationState: "MODEL_LEAN",
      qualificationReason: "Pal projection only; exact sportsbook line and two-way price unavailable",
    });
  }
  for (const p of game.odds?.playerProps || []) {
    rows.push({ ...base,
      id: marketRowId([date, game.id, frozen.checkpoint, "BOOK_PROP", p.marketKey, p.playerName, p.bookmakerKey, p.line]),
      period: "FULL_GAME", marketType: `SPORTSBOOK_PROP:${p.marketKey || "UNKNOWN"}`, subjectType: "player",
      subjectName: p.playerName, line: p.line, source: "parlay-api", sourceMarketKey: p.marketKey,
      sourceMarketName: p.marketLabel, sourceAsOf: p.snapshotAt, book: p.bookmaker,
      bookLine: p.line, bookOverPrice: p.overPrice, bookUnderPrice: p.underPrice, priced: true,
      qualificationState: "PRICED_MARKET", qualificationReason: "Sportsbook contract captured; no Pal player identity match yet",
    });
  }
  return rows;
}

function seasonOf(date, sport) {
  const y = Number(String(date).slice(0, 4));
  const m = Number(String(date).slice(5, 7));
  if (sport === "cfb" || sport === "nfl") return m >= 8 ? String(y) : String(y - 1);
  if (sport === "nba" || sport === "cbb") return m >= 10 ? String(y) : String(y - 1);
  return String(y);
}

export function gameOutcome(final) {
  const d = String(final?.status?.detail || "").toLowerCase();
  if (/postpone/.test(d)) return "POSTPONED";
  if (/cancel/.test(d)) return "CANCELLED";
  if (/suspend/.test(d)) return "SUSPENDED";
  if (final?.status?.completed) return "FINAL";
  return "OPEN";
}

function applyFinal(row, final) {
  const outcome = gameOutcome(final);
  if (outcome === "POSTPONED" || outcome === "CANCELLED" || outcome === "SUSPENDED") {
    const checkpoints = {};
    for (const [k, cp] of Object.entries(row.checkpoints || {})) {
      checkpoints[k] = { ...cp, gameStatus: outcome };
    }
    return { ...row, gameStatus: outcome, checkpoints };
  }
  const hs = Number(final.home?.score);
  const as = Number(final.away?.score);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return row;
  if (!final.status?.completed) return row;
  const lastSnap = (row.snapshots || []).filter((s) => !s.rejectedPostStart && !isPostStart(s.at, row.start)).at(-1) || null;
  const next = {
    ...row,
    actualHome: hs,
    actualAway: as,
    actualTotal: hs + as,
    gradedAt: row.gradedAt || new Date().toISOString(),
    gameStatus: "FINAL",
    closePinHomeMl: row.closePinHomeMl ?? lastSnap?.pinHomeMl ?? null,
    closePinAwayMl: row.closePinAwayMl ?? lastSnap?.pinAwayMl ?? null,
    closeNoVigHome: row.closeNoVigHome ?? lastSnap?.noVigHome ?? null,
  };
  if (final.f5Score?.complete) {
    next.f5ActualHome = final.f5Score.home;
    next.f5ActualAway = final.f5Score.away;
  }
  const checkpoints = {};
  for (const [k, cp] of Object.entries(row.checkpoints || {})) {
    checkpoints[k] = {
      ...cp,
      actualHome: hs,
      actualAway: as,
      actualTotal: hs + as,
      gradedAt: next.gradedAt,
      f5ActualHome: next.f5ActualHome,
      f5ActualAway: next.f5ActualAway,
    };
  }
  next.checkpoints = checkpoints;
  return next;
}

function appendSnapshot(row, game) {
  const snap = snapshotOdds(game);
  if (snap.pinHomeMl == null && snap.pinAwayMl == null && snap.pinOverPrice == null) return row;
  const rejected = isPostStart(snap.at, game.start || row.start);
  const last = (row.snapshots || []).at(-1);
  if (
    last &&
    last.pinHomeMl === snap.pinHomeMl &&
    last.pinAwayMl === snap.pinAwayMl &&
    last.pinOverPrice === snap.pinOverPrice &&
    last.pinSpreadHomePrice === snap.pinSpreadHomePrice
  ) {
    return row;
  }
  const snapshots = [...(row.snapshots || []), { ...snap, rejectedPostStart: rejected }];
  const next = { ...row, snapshots };
  if (!rejected) {
    next.closePinHomeMl = snap.pinHomeMl;
    next.closePinAwayMl = snap.pinAwayMl;
    next.closeNoVigHome = snap.noVigHome;
    next.closeNoVigOver = snap.noVigOver;
    next.closePinTotal = game.odds?.pinTotal ?? row.closePinTotal ?? null;
    next.closePinSpread = game.odds?.pinSpread ?? row.closePinSpread ?? null;
  }
  return next;
}

function matchFinal(row, finals) {
  const hit = finals.find((g) => String(g.id) === String(row.id));
  if (hit) return hit;
  return finals.find(
    (g) =>
      (namesMatch(g.home?.name, row.homeName) || namesMatch(g.home?.abbr, row.homeAbbr)) &&
      (namesMatch(g.away?.name, row.awayName) || namesMatch(g.away?.abbr, row.awayAbbr))
  );
}

function parseTicketMatchup(matchup = "") {
  const parts = String(matchup || "").split("@");
  if (parts.length !== 2) return { away: null, home: null };
  return { away: parts[0].trim(), home: parts[1].trim() };
}

function sameTeam(aName, aAbbr, bName, bAbbr) {
  return (
    namesMatch(aName, bName) ||
    namesMatch(aName, bAbbr) ||
    namesMatch(aAbbr, bName) ||
    namesMatch(aAbbr, bAbbr)
  );
}

function ticketToMatchRef(ticket) {
  const parsed = parseTicketMatchup(ticket.matchup);
  return {
    sport: ticket.sport,
    date: ticket.date || null,
    id: ticket.gameId || null,
    homeName: parsed.home,
    awayName: parsed.away,
  };
}

function finalToMatchRef(final) {
  return {
    sport: final.sport || null,
    date: final.date || null,
    id: final.id || null,
    homeName: final.home?.name || final.homeName || null,
    homeAbbr: final.home?.abbr || final.homeAbbr || null,
    awayName: final.away?.name || final.awayName || null,
    awayAbbr: final.away?.abbr || final.awayAbbr || null,
    start: final.start || null,
    homeScore: final.home?.score ?? final.actualHome ?? null,
    awayScore: final.away?.score ?? final.actualAway ?? null,
    completed: final.status?.completed === true || (final.actualHome != null && final.actualAway != null),
  };
}

function ctDateDiffDays(a, b) {
  if (!a || !b) return Infinity;
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return Infinity;
  return Math.abs(Math.round((da - db) / 86400000));
}

export function resolveFinalForTicket(ticket, finals = []) {
  const t = ticketToMatchRef(ticket);
  const rawCandidates = (finals || [])
    .map(finalToMatchRef)
    .filter((f) => f.completed && Number.isFinite(Number(f.homeScore)) && Number.isFinite(Number(f.awayScore)))
    .filter((f) => !t.sport || !f.sport || f.sport === t.sport);
  const uniq = new Map();
  for (const f of rawCandidates) {
    const key = f.id
      ? `id:${String(f.id)}`
      : `g:${f.sport || ""}|${f.date || ""}|${String(f.awayName || "").toLowerCase()}|${String(f.homeName || "").toLowerCase()}|${f.awayScore}|${f.homeScore}`;
    if (!uniq.has(key)) uniq.set(key, f);
  }
  const candidates = [...uniq.values()];
  const byId = t.id ? candidates.find((f) => String(f.id) === String(t.id)) : null;
  if (byId) {
    return {
      id: byId.id,
      sport: byId.sport,
      date: byId.date,
      start: byId.start,
      home: { name: byId.homeName, abbr: byId.homeAbbr, score: Number(byId.homeScore) },
      away: { name: byId.awayName, abbr: byId.awayAbbr, score: Number(byId.awayScore) },
      status: { completed: true, detail: "Final" },
    };
  }
  const byTeams = candidates.filter((f) => {
    const dateOk = !t.date || !f.date || ctDateDiffDays(t.date, f.date) <= 1;
    const homeOk = sameTeam(t.homeName, null, f.homeName, f.homeAbbr);
    const awayOk = sameTeam(t.awayName, null, f.awayName, f.awayAbbr);
    return dateOk && homeOk && awayOk;
  });
  if (!byTeams.length) return null;
  if (byTeams.length > 1) {
    const withDate = byTeams
      .map((f) => ({ f, d: ctDateDiffDays(t.date, f.date) }))
      .sort((a, b) => a.d - b.d);
    if (withDate.length && withDate[0].d < Infinity) {
      const nearest = withDate.filter((x) => x.d === withDate[0].d).map((x) => x.f);
      if (nearest.length === 1) {
        const hit = nearest[0];
        return {
          id: hit.id,
          sport: hit.sport,
          date: hit.date,
          start: hit.start,
          home: { name: hit.homeName, abbr: hit.homeAbbr, score: Number(hit.homeScore) },
          away: { name: hit.awayName, abbr: hit.awayAbbr, score: Number(hit.awayScore) },
          status: { completed: true, detail: "Final" },
        };
      }
    }
    return null;
  }
  const hit = byTeams[0];
  return {
    id: hit.id,
    sport: hit.sport,
    date: hit.date,
    start: hit.start,
    home: { name: hit.homeName, abbr: hit.homeAbbr, score: Number(hit.homeScore) },
    away: { name: hit.awayName, abbr: hit.awayAbbr, score: Number(hit.awayScore) },
    status: { completed: true, detail: "Final" },
  };
}

export function accuracyOf(rows) {
  const graded = (rows || []).filter(
    (r) => r.actualHome != null && r.actualAway != null && ((r.projHome != null && r.projAway != null) || (r.palHome != null && r.palAway != null))
  );
  const n = graded.length;
  const empty = {
    n: 0,
    maeHome: null,
    maeAway: null,
    maeTeam: null,
    maeTotal: null,
    maeMargin: null,
    rmseTotal: null,
    biasTotal: null,
    winnerHit: null,
    winnerHitScore: null,
    winnerHitProb: null,
    brierModel: null,
    brierMarket: null,
    brierPal: null,
    brierScore: null,
    logLossModel: null,
    logLossMarket: null,
    logLossPal: null,
    withinTeam05: null,
    withinTeam1: null,
    withinTeam2: null,
    withinTotal05: null,
    withinTotal1: null,
    withinTotal2: null,
    withinTotal3: null,
    withinTotal4: null,
    withinMargin1: null,
    withinMargin2: null,
    withinMargin3: null,
    calibration: [],
    calibrationHome: [],
    models: {},
  };
  if (!n) return empty;
  const sport = graded[0]?.sport || "mlb";
  const withProj = graded.filter((r) => r.projHome != null && r.projAway != null);
  const decidedScore = withProj.filter((r) => r.actualHome !== r.actualAway && r.projHome !== r.projAway);
  const winnerHits = decidedScore.filter((r) => (r.projHome > r.projAway) === (r.actualHome > r.actualAway)).length;
  const decidedRows = graded.filter((r) => r.actualHome !== r.actualAway);
  const pKey = (r) => r.pHomeFinal ?? r.pHome;
  const brier = (getP) => {
    const xs = decidedRows.filter((r) => getP(r) != null);
    if (!xs.length) return null;
    return mean(xs.map((r) => brierScore(getP(r), r.actualHome > r.actualAway ? 1 : 0)));
  };
  const ll = (getP) => {
    const xs = decidedRows.filter((r) => getP(r) != null);
    if (!xs.length) return null;
    return mean(xs.map((r) => logLoss(getP(r), r.actualHome > r.actualAway ? 1 : 0)));
  };
  const homeErrs = withProj.map((r) => r.projHome - r.actualHome);
  const awayErrs = withProj.map((r) => r.projAway - r.actualAway);
  const teamErrs = [...homeErrs, ...awayErrs];
  const totErrs = withProj.map((r) => (r.projTotal ?? r.projHome + r.projAway) - (r.actualTotal ?? r.actualHome + r.actualAway));
  const mgnErrs = withProj.map((r) => (r.projMargin ?? r.projHome - r.projAway) - (r.actualHome - r.actualAway));
  const share = (xs, thr) => (xs.length ? xs.filter((e) => Math.abs(e) <= thr).length / xs.length : null);
  const probDecided = decidedRows.filter((r) => pKey(r) != null);
  const probHits = probDecided.filter((r) => (pKey(r) > 0.5) === (r.actualHome > r.actualAway)).length;
  const totBands = withinBands(totErrs, sport, "total");
  const teamBands = withinBands(teamErrs, sport, "team");
  const mgnBands = withinBands(mgnErrs, sport, "margin");
  const brierModel = brier(pKey);
  const brierMkt = brier((r) => r.impliedHome ?? r.pMarket);
  return {
    n,
    sport,
    maeHome: mean(homeErrs.map(Math.abs)),
    maeAway: mean(awayErrs.map(Math.abs)),
    maeTeam: mean(teamErrs.map(Math.abs)),
    maeTotal: mean(totErrs.map(Math.abs)),
    maeMargin: mean(mgnErrs.map(Math.abs)),
    rmseTotal: totErrs.length ? rmse(totErrs) : null,
    rmseMargin: mgnErrs.length ? rmse(mgnErrs) : null,
    biasTotal: mean(totErrs),
    medianError: median(totErrs),
    medianAbs: median(totErrs.map(Math.abs)),
    winnerHit: decidedScore.length ? winnerHits / decidedScore.length : null,
    winnerHitScore: decidedScore.length ? winnerHits / decidedScore.length : null,
    winnerHitProb: probDecided.length ? probHits / probDecided.length : null,
    brierModel,
    brierMarket: brierMkt,
    brierPal: brier((r) => r.pPal),
    brierScore: brier((r) => r.pScore),
    brierImprovement: brierModel != null && brierMkt != null ? brierMkt - brierModel : null,
    logLossModel: ll(pKey),
    logLossMarket: ll((r) => r.impliedHome ?? r.pMarket),
    logLossPal: ll((r) => r.pPal),
    withinTeam05: teamBands.within05 ?? share(teamErrs, 0.5),
    withinTeam1: teamBands.within1 ?? share(teamErrs, 1),
    withinTeam2: teamBands.within2 ?? share(teamErrs, 2),
    withinTotal05: totBands.within05 ?? share(totErrs, 0.5),
    withinTotal1: totBands.within1 ?? share(totErrs, 1),
    withinTotal2: totBands.within2 ?? share(totErrs, 2),
    withinTotal3: totBands.within3 ?? share(totErrs, 3),
    withinTotal4: totBands.within4 ?? share(totErrs, 4),
    withinMargin1: mgnBands.within1 ?? share(mgnErrs, 1),
    withinMargin2: mgnBands.within2 ?? share(mgnErrs, 2),
    withinMargin3: mgnBands.within3 ?? share(mgnErrs, 3),
    within: { total: totBands, team: teamBands, margin: mgnBands },
    calibration: calibrationFav(decidedRows, pKey),
    calibrationHome: calibrationHome(decidedRows, pKey),
    models: {
      proprietary: modelBlock(graded, "projHome", "projAway", (r) => r.pScore),
      pal: modelBlock(graded, "palHome", "palAway", (r) => r.pPal ?? r.palPHome),
      market: modelBlock(graded, null, null, (r) => r.impliedHome ?? r.pMarket),
      ensemble: modelBlock(graded, "projHome", "projAway", pKey),
    },
  };
}

function modelBlock(rows, homeKey, awayKey, getP) {
  const scored = homeKey
    ? rows.filter((r) => r[homeKey] != null && r[awayKey] != null && r.actualHome != null)
    : rows.filter((r) => r.actualHome != null);
  const decided = scored.filter((r) => r.actualHome !== r.actualAway);
  const n = scored.length;
  if (!n) return { n: 0, maeTeam: null, maeTotal: null, maeMargin: null, winnerHit: null, brier: null };
  const team = [];
  const tot = [];
  const mgn = [];
  let hits = 0;
  let decidedN = 0;
  if (homeKey) {
    for (const r of scored) {
      team.push(Math.abs(r[homeKey] - r.actualHome), Math.abs(r[awayKey] - r.actualAway));
      tot.push(Math.abs(r[homeKey] + r[awayKey] - r.actualHome - r.actualAway));
      mgn.push(Math.abs(r[homeKey] - r[awayKey] - (r.actualHome - r.actualAway)));
      if (r.actualHome !== r.actualAway && r[homeKey] !== r[awayKey]) {
        decidedN += 1;
        if ((r[homeKey] > r[awayKey]) === (r.actualHome > r.actualAway)) hits += 1;
      }
    }
  }
  const brierXs = decided.filter((r) => getP(r) != null);
  return {
    n,
    maeTeam: team.length ? mean(team) : null,
    maeTotal: tot.length ? mean(tot) : null,
    maeMargin: mgn.length ? mean(mgn) : null,
    winnerHit: decidedN ? hits / decidedN : null,
    brier: brierXs.length ? mean(brierXs.map((r) => brierScore(getP(r), r.actualHome > r.actualAway ? 1 : 0))) : null,
  };
}

const HOME_BUCKETS = Array.from({ length: 10 }, (_, i) => [i / 10, i === 9 ? 1.01 : (i + 1) / 10]);
const FAV_BUCKETS = [
  [0.5, 0.52],
  [0.52, 0.54],
  [0.54, 0.56],
  [0.56, 0.58],
  [0.58, 0.6],
  [0.6, 0.65],
  [0.65, 0.7],
  [0.7, 1.01],
];

function bucketRows(rows, getP, buckets, transform) {
  return buckets.map(([lo, hi]) => {
    const xs = rows.filter((r) => {
      const raw = getP(r);
      if (raw == null) return false;
      const p = transform ? transform(raw) : raw;
      return p >= lo && p < hi;
    });
    const n = xs.length;
    const predicted = n ? mean(xs.map((r) => (transform ? transform(getP(r)) : getP(r)))) : null;
    const actual = n
      ? mean(
          xs.map((r) => {
            const raw = getP(r);
            const homeWin = r.actualHome > r.actualAway ? 1 : 0;
            if (!transform) return homeWin;
            return raw >= 0.5 ? homeWin : 1 - homeWin;
          })
        )
      : null;
    return {
      bucket: hi >= 1 ? `${Math.round(lo * 100)}+` : `${Math.round(lo * 100)}–${Math.round(hi * 100)}`,
      n,
      predicted,
      actual,
      error: predicted != null && actual != null ? predicted - actual : null,
    };
  });
}

export function calibrationOf(rows, getP) {
  return bucketRows(rows, getP, FAV_BUCKETS, (p) => Math.max(p, 1 - p));
}

function calibrationFav(rows, getP) {
  return calibrationOf(rows, getP);
}

function calibrationHome(rows, getP) {
  return bucketRows(rows, getP, HOME_BUCKETS, null);
}

function splitMatchupLabel(matchup = "") {
  const parts = String(matchup || "").split("@");
  if (parts.length !== 2) return { away: null, home: null };
  return { away: parts[0].trim(), home: parts[1].trim() };
}

function canonicalTeamLabel(sport, name, abbr) {
  const rawName = String(name || "").trim();
  const rawAbbr = String(abbr || "").trim();
  if (!rawName && !rawAbbr) return null;
  const probe = rawName || rawAbbr;
  const hit = resolveTeam(sport || "mlb", {
    name: probe,
    displayName: probe,
    school: probe,
    fullName: probe,
    abbr: rawAbbr || probe,
  });
  return hit?.displayName || hit?.school || rawName || rawAbbr || null;
}

export function canonicalMatchupDisplay(row = {}) {
  const parsed = splitMatchupLabel(row.matchup);
  const awayDisplayName = canonicalTeamLabel(row.sport, row.awayName || parsed.away, row.awayAbbr || parsed.away);
  const homeDisplayName = canonicalTeamLabel(row.sport, row.homeName || parsed.home, row.homeAbbr || parsed.home);
  return {
    awayDisplayName,
    homeDisplayName,
    matchupDisplay: awayDisplayName && homeDisplayName
      ? `${awayDisplayName} @ ${homeDisplayName}`
      : row.matchup || row.gameId || row.id || "—",
  };
}

export function decorateRow(row) {
  const canonical = canonicalMatchupDisplay(row);
  if (row.actualHome == null || row.projHome == null) {
    return {
      ...row,
      ...canonical,
      errHome: null,
      errAway: null,
      errTotal: null,
      errMargin: null,
      status: row.projHome == null ? "NO_PROJ" : "OPEN",
    };
  }
  return {
    ...row,
    ...canonical,
    errHome: row.projHome - row.actualHome,
    errAway: row.projAway - row.actualAway,
    errTotal: row.projTotal - row.actualTotal,
    errMargin: row.projMargin - (row.actualHome - row.actualAway),
    status: "GRADED",
  };
}

function tallyPersist(counts, res) {
  const next = counts || emptyWriteCounts();
  if (res?.skipped) return next;
  next.writesAttempted += 1;
  if (res?.conflict) next.immutableConflicts = (next.immutableConflicts || 0) + 1;
  if (!res || res.ok === false) {
    next.writesFailed += 1;
    if (res?.kind === "snapshot" || res?.inserted != null) {
      next.snapshotsAttempted += 1;
      next.snapshotsFailed += 1;
    }
    return next;
  }
  next.writesSucceeded += 1;
  if (res.kind === "snapshot" || res.inserted != null || res.already != null) {
    next.snapshotsAttempted += 1;
    next.snapshotsInserted += res.inserted || 0;
    next.snapshotsAlready += res.already || 0;
    next.snapshotsFailed += res.failed || 0;
  }
  return next;
}

export async function freezeSlate(slate, env = {}) {
  const counts = emptyWriteCounts();
  if (!slate?.sport || !slate.games) return { ok: true, counts, games: 0 };
  const cfCache = env.caches;
  const ledger = await loadLedger(slate.sport, cfCache);
  let changed = false;
  const writes = [];
  for (const game of slate.games) {
    const k = rowKey(slate.date, game.id);
    const existing = ledger.games[k];
    const liveOrFinal = Boolean(game.status?.live || game.status?.completed);

    if (!existing && !liveOrFinal) {
      writes.push(persistGame(env, game, slate.date));
      const frozen = freezeFromGame(slate.date, game);
      if (frozen) {
        const first = { ...frozen, checkpoint: "FIRST_AVAILABLE" };
        const cps = { FIRST_AVAILABLE: first };
        if (frozen.checkpoint !== "FIRST_AVAILABLE") cps[frozen.checkpoint] = { ...frozen };
        frozen.checkpoints = cps;
        ledger.games[k] = frozen;
        changed = true;
        writes.push(persistFrozen(env, frozen, game, slate.date));
        writes.push(persistCheckpoint(env, first, game, slate.date));
        if (frozen.checkpoint !== "FIRST_AVAILABLE") {
          writes.push(persistCheckpoint(env, frozen, game, slate.date));
        }
        writes.push(persistMatchingRec(env, slate, game, frozen));
        writes.push(persistGameChallengers(env, game, slate.sport));
        if (slate.sport === "mlb") {
          writes.push(persistMlbMarketProjections(env, palMarketRowsFromGame(slate.date, game, frozen)));
        }
      }
      continue;
    }

    if (existing && !liveOrFinal) {
      let next = appendSnapshot(existing, game);
      const packed = freezeFromGame(slate.date, game);
      if (packed) {
        if (slate.sport === "mlb") {
          writes.push(persistMlbMarketProjections(env, palMarketRowsFromGame(slate.date, game, packed)));
        }
        const cps = { ...(next.checkpoints || {}) };
        if (!cps.FIRST_AVAILABLE) {
          cps.FIRST_AVAILABLE = { ...packed, checkpoint: "FIRST_AVAILABLE" };
          writes.push(persistCheckpoint(env, cps.FIRST_AVAILABLE, game, slate.date));
          changed = true;
        }
        if (!cps[packed.checkpoint]) {
          cps[packed.checkpoint] = { ...packed };
          writes.push(persistCheckpoint(env, cps[packed.checkpoint], game, slate.date));
          next = { ...next, checkpoints: cps, checkpoint: packed.checkpoint };
          writes.push(persistMatchingRec(env, slate, game, packed));
          writes.push(persistGameChallengers(env, game, slate.sport));
          changed = true;
        }
        const canon = pickCanonical(Object.values(cps).map((c) => ({ ...c, id: next.id, date: next.date })))[0];
        if (canon && materiallyChanged(next, canon)) {
          next = {
            ...next,
            ...canon,
            id: next.id,
            snapshots: next.snapshots,
            checkpoints: cps,
            actualHome: next.actualHome,
            actualAway: next.actualAway,
            actualTotal: next.actualTotal,
            gradedAt: next.gradedAt,
          };
          writes.push(persistFrozen(env, next, game, slate.date));
          changed = true;
        }
      }
      if (next !== existing) {
        ledger.games[k] = next;
        writes.push(persistSnap(env, next, slate.date, game));
      }
    }

    if (existing && game.status?.completed && existing.actualHome == null) {
      const graded = applyFinal(appendSnapshot(existing, game), game);
      ledger.games[k] = graded;
      changed = true;
      writes.push(persistFrozen(env, graded, game, slate.date));
      for (const cp of Object.values(graded.checkpoints || {})) {
        writes.push(persistCheckpoint(env, { ...graded, ...cp, id: graded.id, date: graded.date }, game, slate.date));
      }
      writes.push(gradeGameChallengers(env, game, slate.sport));
    }
  }
  const results = await Promise.all(writes);
  for (const res of results) tallyPersist(counts, res);
  if (changed) await saveLedger(slate.sport, ledger, cfCache);
  const failReasons = [...new Set(results.filter((r) => r && r.ok === false).map((r) => r.reason).filter(Boolean))];
  return { ok: counts.writesFailed === 0, counts, games: slate.games.length, failReasons };
}

async function persistMatchingRec(env, slate, game, frozen) {
  await persistStrategy(env, STRATEGY_HC_V1);
  const bundle = recommendBundle(slate.sport, game, game.model);
  const rec = bundle?.qualified;
  if (!rec || !ticketMatchesStrategy(rec)) return { ok: true, skipped: true, reason: "no-match" };
  if (game.cfb && !game.cfb.bettingAllowed) return { ok: true, skipped: true, reason: "cfb-blocked" };
  if (slate.sport === "nfl" && game.projectionKind !== "FBIS") return { ok: true, skipped: true, reason: "nfl-no-independent-model" };
  return persistStrategyTicket(
    env,
    packTicket(
      {
        ...rec,
        sport: slate.sport,
        gameId: game.id,
        matchup: frozen?.matchup || `${game.away?.abbr} @ ${game.home?.abbr}`,
        modelVersion: game.modelVersion || frozen?.modelVersion,
        checkpoint: frozen?.checkpoint,
        dataQuality: game.quality?.score ?? frozen?.dataQuality,
        pinVig: rec.pinVig ?? game.pin?.ml?.vig,
        executionPrice: rec.executionPrice ?? null,
        benchmarkPrice: rec.pinPrice,
        entryNoVig: rec.implied ?? rec.entryNoVig,
        qualifiedAt: frozen?.frozenAt || new Date().toISOString(),
        qualified: true,
        tag: rec.tag,
      },
      { role: "prospective", date: slate.date }
    ),
    { strictConflict: false }
  );
}

async function gradeStrategyAgainstFinals(env, finals) {
  const tickets = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id });
  const open = (tickets || []).filter((t) => !t.result || t.result === "OPEN");
  const minDate = open.map((t) => t.date).filter(Boolean).sort()[0] || lastNDatesCT(8).at(-1);
  const snapshotQ = await querySnapshots(env, { since: minDate, checkpoint: "LATEST" });
  const snapshotFinals = (snapshotQ.rows || [])
    .filter((r) => r.actualHome != null && r.actualAway != null)
    .map((r) => ({
      id: r.id,
      sport: r.sport,
      date: r.date,
      start: r.start,
      home: { name: r.homeName, abbr: r.homeAbbr, score: r.actualHome },
      away: { name: r.awayName, abbr: r.awayAbbr, score: r.actualAway },
      status: { completed: true, detail: "Final" },
    }));
  const allFinals = [...(finals || []), ...snapshotFinals];
  const jobs = [];
  for (const t of tickets) {
    if (t.result && t.result !== "OPEN") continue;
    const g = resolveFinalForTicket(t, allFinals);
    const graded = gradeStrategyResult(t, g);
    if (graded) jobs.push(gradeStrategyTicket(env, t.id, graded));
  }
  await Promise.all(jobs);
}

async function gradeExecutedBets(env, finals) {
  const listed = await queryExecutedBets(env, { includeRaw: false });
  const byId = new Map((finals || []).map((g) => [String(g.id), g]));
  const jobs = [];
  for (const t of listed.rows || []) {
    if (!t.gameId) continue;
    const g = byId.get(String(t.gameId));
    if (!g) continue;
    const detail = String(g.status?.detail || "").toLowerCase();
    if (g.status?.completed !== true && !/\bfinal\b|cancel|void|postpone|suspend/.test(detail)) continue;
    const settled = settleExecutedBet(t, {
      ...g,
      status: g.status || { completed: g.home?.score != null },
      home: g.home,
      away: g.away,
      actualHome: g.home?.score ?? g.actualHome,
      actualAway: g.away?.score ?? g.actualAway,
      f5Score: g.f5Score,
    });
    if (settled.result && settled.result !== "OPEN") {
      const changed = settled.result !== t.result || Number(settled.profit) !== Number(t.profit);
      if (changed) jobs.push(updateExecutedBet(env, t.id, settled, t.result && t.result !== "OPEN" ? "settlement-correction" : "settlement"));
    }
  }
  await Promise.all(jobs);
}

function palJson(row) {
  return JSON.stringify({
    home: row.palHome,
    away: row.palAway,
    f5Home: row.f5Home ?? row.palF5Home,
    f5Away: row.f5Away ?? row.palF5Away,
    f5HomeWin: row.f5HomeWin,
    f5AwayWin: row.f5AwayWin,
    pHome: row.pPal ?? row.palPHomeStored,
    totals: row.palTotals || null,
    teamTotals: row.palTeamTotals || null,
    props: row.palProps || null,
    unknownMarkets: row.palUnknownMarkets || null,
    runLine: row.palRunLine || null,
    park: row.palPark || row.park || "",
    parkName: row.park || "",
    matchup: row.palMatchup || null,
    asOf: row.palAsOf,
    requestId: row.palRequestId,
    lineupsOfficial: row.lineupsOfficial,
    homeSp: row.homeSp || null,
    awaySp: row.awaySp || null,
    homeAbbr: row.homeAbbr || null,
    awayAbbr: row.awayAbbr || null,
    homeName: row.homeName || null,
    awayName: row.awayName || null,
    week: row.week ?? null,
    conference: row.conference || null,
    season: row.season || null,
    start: row.start || null,
    pinTotal: row.pinTotal ?? null,
    pinSpread: row.pinSpread ?? null,
    marketProjHome: row.marketProjHome ?? null,
    marketProjAway: row.marketProjAway ?? null,
    uncertainty: row.uncertainty || null,
  });
}

function stubGame(row) {
  return {
    id: row.id,
    sport: row.sport,
    start: row.start,
    home: { name: row.homeName, abbr: row.homeAbbr },
    away: { name: row.awayName, abbr: row.awayAbbr },
  };
}

async function persistFrozen(env, row, game, date) {
  const results = [];
  results.push(await persistGame(env, game || stubGame(row), date));
  results.push(
    await persistPrediction(env, {
      id: `${row.date}:${row.id}`,
      gameId: row.id,
      sport: row.sport,
      date: row.date,
      matchup: row.matchup,
      checkpoint: row.checkpoint,
      modelVersion: row.modelVersion,
      asOf: row.frozenAt,
      projHome: row.projHome,
      projAway: row.projAway,
      projTotal: row.projTotal,
      projMargin: row.projMargin,
      palHome: row.palHome,
      palAway: row.palAway,
      pHomeFinal: row.pHomeFinal,
      pAwayFinal: row.pAwayFinal,
      pMarket: row.pMarket,
      pEspn: row.pEspn,
      pScore: row.pScore,
      pForm: row.pForm,
      pPal: row.pPal,
      weightsJson: JSON.stringify(row.weights || {}),
      layersJson: JSON.stringify(row.layers || {}),
      palJson: palJson(row),
      palAsOf: row.palAsOf,
      lineupsOfficial: row.lineupsOfficial,
      dataQuality: row.dataQuality,
      pinHomeMl: row.pinHomeMl,
      pinAwayMl: row.pinAwayMl,
      pinVig: row.pinVig,
      engine: row.engine,
      actualHome: row.actualHome,
      actualAway: row.actualAway,
      gradedAt: row.gradedAt,
      projectionState: row.projectionState,
      projectionKind: row.projectionKind,
    })
  );
  results.push(await persistSnap(env, row, date, game));
  const failed = results.filter((r) => r && r.ok === false);
  return {
    ok: failed.length === 0,
    reason: failed[0]?.reason || null,
    inserted: 0,
    already: 0,
    failed: failed.length,
    kind: "write",
  };
}

async function persistCheckpoint(env, row, game, date) {
  if (!row?.checkpoint) return { ok: false, reason: "no-checkpoint", kind: "snapshot", inserted: 0, already: 0, failed: 1 };
  await persistGame(env, game || stubGame(row), date || row.date);
  const res = await persistSnapshot(env, {
    id: snapshotKey(row.date || date, row.id, row.checkpoint),
    gameId: row.id,
    sport: row.sport,
    date: row.date || date,
    matchup: row.matchup,
    checkpoint: row.checkpoint,
    modelVersion: row.modelVersion,
    frozenAt: row.frozenAt,
    projHome: row.projHome,
    projAway: row.projAway,
    projTotal: row.projTotal,
    projMargin: row.projMargin,
    palHome: row.palHome,
    palAway: row.palAway,
    palF5Home: row.f5Home,
    palF5Away: row.f5Away,
    palPHome: row.pPal,
    palAsOf: row.palAsOf,
    palRequestId: row.palRequestId,
    palJson: palJson(row),
    lineupsOfficial: row.lineupsOfficial,
    pHomeFinal: row.pHomeFinal,
    pMarket: row.pMarket,
    pEspn: row.pEspn,
    pScore: row.pScore,
    pForm: row.pForm,
    pPal: row.pPal,
    weightsJson: JSON.stringify(row.weights || {}),
    layersJson: JSON.stringify(row.layers || {}),
    dataQuality: row.dataQuality,
    pinHomeMl: row.pinHomeMl,
    pinAwayMl: row.pinAwayMl,
    pinVig: row.pinVig,
    engine: row.engine,
    actualHome: row.actualHome,
    actualAway: row.actualAway,
    gradedAt: row.gradedAt,
    deploymentCommit: deploymentCommit(env),
    season: row.season,
    start: row.start,
    pinSpread: row.pinSpread,
    pinTotal: row.pinTotal,
    noVigHome: row.noVigHome ?? row.entryNoVigHome,
    noVigAway: row.noVigAway,
    noVigOver: row.noVigOver,
    noVigUnder: row.noVigUnder,
    pOver: row.pOver,
    pSpreadHome: row.pSpreadHome,
    uncertainty: row.uncertainty,
    marketAt: row.marketAt,
    gameStatus: row.gameStatus,
    week: row.week,
    conference: row.conference,
    pAwayFinal: row.pAwayFinal,
    projectionState: row.projectionState,
    projectionKind: row.projectionKind,
    bettingAllowed: row.bettingAllowed,
    priorVersion: row.priorVersion,
    qualityFlags: row.qualityFlags,
    projectionFlags: row.qualityFlags || row.uncertainty?.flags || null,
  });
  return { ...res, kind: "snapshot" };
}

async function persistSnap(env, row, date, game = null) {
  const packed = game
    ? packPinOddsRows({ ...game, date, sport: row.sport, start: row.start || game.start }, { capturedAt: new Date().toISOString(), checkpoint: row.checkpoint })
    : { rows: [] };
  let rows = packed.rows;
  if (!rows.length) {
    const snap = (row.snapshots || []).at(-1);
    if (!snap) return { ok: true, skipped: true, reason: "no-odds" };
    rows = [
      {
        gameId: row.id,
        sport: row.sport,
        date,
        book: "Pinnacle",
        market: "ml",
        period: "fg",
        side: "HOME",
        line: null,
        price: snap.pinHomeMl,
        implied: null,
        noVig: snap.noVigHome,
        capturedAt: snap.at,
        gameStart: row.start,
        rejectedPostStart: snap.rejectedPostStart ? 1 : 0,
        paired: snap.pinHomeMl != null && snap.pinAwayMl != null ? 1 : 0,
      },
    ];
  }
  const results = [];
  for (const r of rows) results.push(await persistOddsSnapshot(env, r));
  const failed = results.filter((r) => r && r.ok === false);
  return {
    ok: failed.length === 0,
    reason: failed[0]?.reason || null,
    inserted: results.filter((r) => r?.ok).length,
    already: 0,
    failed: failed.length,
    kind: "odds",
  };
}

async function persistGradedLedger(env, ledger) {
  const jobs = [];
  for (const row of Object.values(ledger.games || {})) {
    if (row.actualHome == null) continue;
    jobs.push(persistFrozen(env, row, stubGame(row), row.date));
    const cps = Object.values(row.checkpoints || {});
    if (cps.length) {
      for (const cp of cps) {
        jobs.push(persistCheckpoint(env, { ...row, ...cp, id: row.id, date: row.date }, stubGame(row), row.date));
      }
    } else if (row.checkpoint) {
      jobs.push(persistCheckpoint(env, row, stubGame(row), row.date));
    }
  }
  const results = await Promise.all(jobs);
  const counts = emptyWriteCounts();
  for (const res of results) tallyPersist(counts, res);
  return counts;
}

async function writeDailyMetrics(env, rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (row.actualHome == null) continue;
    const keys = [
      `${row.date}|${row.sport}|${row.modelVersion || ""}|${row.checkpoint || "LATEST"}`,
      `${row.date}|${row.sport}|${row.modelVersion || ""}|LATEST`,
    ];
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
  }
  const jobs = [];
  for (const [key, xs] of groups) {
    const [date, sport, modelVersion, checkpoint] = key.split("|");
    const acc = accuracyOf(checkpoint === "LATEST" ? pickCanonical(xs) : xs);
    jobs.push(
      persistDailyMetrics(env, {
        date,
        sport,
        modelVersion,
        checkpoint,
        n: acc.n,
        brier: acc.brierModel,
        logLoss: acc.logLossModel,
        maeTotal: acc.maeTotal,
        maeMargin: acc.maeMargin,
        winnerHit: acc.winnerHit,
      })
    );
  }
  await Promise.all(jobs);
}

export async function harvestSport(sport, days, env = {}, opts = {}) {
  const fetchFn = opts.fetchResultsFn || fetchResults;
  const cfCache = env.caches;
  const n = Math.max(1, Math.min(Number(days) || 8, KEEP_DAYS));
  const harvestKey = `${CACHE_VER}:harvest:${sport}:${n}`;
  const cached = await readCache(harvestKey, cfCache, HARVEST_TTL_MS);
  const ledger = await loadLedger(sport, cfCache);
  const dates = lastNDatesCT(n);
  const finals = [];
  const errors = [];
  let dateFailures = 0;
  let counts = emptyWriteCounts();
  let finalsGraded = 0;
  let finalsFailed = 0;

  if (cached?.finals && cached.ledgerSavedAt === ledger.savedAt) {
    const persisted = await persistGradedLedger(env, ledger);
    counts = mergeWriteCounts(counts, persisted);
    await writeDailyMetrics(env, flattenLedgerRows(ledger));
    return {
      ...cached,
      ok: counts.writesFailed === 0,
      jobCounts: counts,
      dates,
      errors,
      db: await dbPayload(env),
    };
  }

  const writes = [];
  for (const date of dates) {
    try {
      const results = await fetchFn(sport, date);
      for (const g of results) finals.push({ ...g, date });
      for (const g of results) {
        const k = rowKey(date, g.id);
        const existing =
          ledger.games[k] ||
          Object.values(ledger.games).find((row) => row.date === date && matchFinal(row, [g]));
        if (existing && existing.actualHome == null) {
          const next = applyFinal(existing, g);
          ledger.games[existing.date + ":" + existing.id] = next;
          writes.push(persistFrozen(env, next, g, date));
          for (const cp of Object.values(next.checkpoints || { [next.checkpoint || "CLOSE"]: next })) {
            writes.push(persistCheckpoint(env, { ...next, ...cp, id: next.id, date: next.date }, g, date));
          }
          if (next.actualHome != null) {
            finalsGraded += 1;
            writes.push(gradeSnapshotsForGame(env, {
              gameId: next.id,
              actualHome: next.actualHome,
              actualAway: next.actualAway,
              gradedAt: next.gradedAt,
            }));
            writes.push(
              applyFinalToForm(env, {
                sport,
                season: Number(cfbSeasonYear(date)),
                gameId: next.id,
                date,
                home: { name: next.homeName, abbr: next.homeAbbr, espnId: next.espnIdHome },
                away: { name: next.awayName, abbr: next.awayAbbr, espnId: next.espnIdAway },
                homeScore: next.actualHome,
                awayScore: next.actualAway,
              })
            );
          } else {
            finalsFailed += 1;
          }
        }
      }
    } catch (err) {
      dateFailures += 1;
      errors.push(`${sport}@${date}: ${String(err?.message || err)}`);
      await enqueueHarvestRetry(env, { sport, date, reason: String(err?.message || err) });
      await setMeta(env, "last_harvest_error", String(err?.message || err));
      await setMeta(env, "last_harvest_error_at", new Date().toISOString());
    }
  }
  const writeResults = await Promise.all(writes);
  for (const res of writeResults) tallyPersist(counts, res);

  const saved = await saveLedger(sport, ledger, cfCache);
  const persisted = await persistGradedLedger(env, saved);
  counts = mergeWriteCounts(counts, persisted);
  await writeDailyMetrics(env, flattenLedgerRows(saved));
  const daily = buildDailyReport(sport, flattenLedgerRows(saved), {
    date: todayCT(),
    title: sport === "cfb" ? "CFB research window" : `${sport} harvest`,
    accuracy: accuracyOf(flattenLedgerRows(saved).filter((r) => r.actualHome != null)),
  });
  const dailyRes = await persistDailyReport(env, daily);
  if (dailyRes && dailyRes.ok === false) tallyPersist(counts, dailyRes);
  await gradeStrategyAgainstFinals(env, finals);
  await gradeExecutedBets(env, finals);
  const rows = Object.values(saved.games)
    .filter((r) => r.sport === sport || !r.sport)
    .sort((a, b) => String(b.date).localeCompare(a.date) || String(a.matchup).localeCompare(b.matchup))
    .map(decorateRow);
  const windowDates = new Set(dates);
  const needsGrade = Object.values(saved.games || {}).some(
    (r) => windowDates.has(r.date) && awaitingFinal(r)
  );
  const sportFailed =
    counts.writesFailed > 0 ||
    (needsGrade && (dateFailures === dates.length || (dateFailures > 0 && finals.length === 0)));
  if (!sportFailed) {
    for (const date of dates) await resolveHarvestRetry(env, { sport, date });
  } else {
    await enqueueHarvestRetry(env, { sport, date: dates[0], reason: errors[0] || "harvest-partial" });
  }
  const report = {
    sport,
    sportName: SPORTS[sport]?.name || sport,
    ok: !sportFailed && counts.writesFailed === 0,
    generatedAt: new Date().toISOString(),
    harvestedAt: new Date().toISOString(),
    days: n,
    dates,
    recipe: RECIPE_GUIDE[sport] || null,
    accuracy: accuracyOf(rows),
    games: rows,
    gamesDiscovered: rows.length,
    finals: finals.filter((g) => g.status?.completed).map((g) => ({
      id: g.id,
      sport,
      date: g.date,
      home: g.home,
      away: g.away,
      status: g.status,
      f5Score: g.f5Score,
    })),
    finalsDiscovered: finals.filter((g) => g.status?.completed).length,
    finalsGraded,
    finalsFailed,
    jobCounts: counts,
    errors,
    daily,
    ledgerSavedAt: saved.savedAt,
    db: await dbPayload(env),
  };
  if (report.ok) await writeCache(harvestKey, report, cfCache, HARVEST_TTL_MS);
  return report;
}

/** A frozen row needs a final only after kickoff. Upcoming games must not fail harvest on a 403. */
export function awaitingFinal(row, now = Date.now()) {
  if (!row || row.actualHome != null) return false;
  const startMs = Date.parse(row.start || "");
  if (Number.isFinite(startMs) && startMs > now) return false;
  return true;
}

function flattenLedgerRows(ledger) {
  const out = [];
  for (const row of Object.values(ledger.games || {})) {
    const cps = Object.values(row.checkpoints || {});
    if (cps.length) {
      for (const cp of cps) out.push({ ...row, ...cp, id: row.id, date: row.date });
    } else {
      out.push(row);
    }
  }
  return out;
}

async function dbPayload(env) {
  const ping = await pingDb(env);
  const counts = await countToday(env, todayCT());
  const durable = await durableHealth(env);
  const warnings = staleScheduleWarning(durable);
  const meta = await readMeta(env);
  return {
    ...ping,
    ...counts,
    source: durable.source,
    healthSource: durable.source,
    lastCollect: durable.lastCollectSuccessAt || counts.lastCollect,
    lastHarvest: durable.lastHarvestSuccessAt || counts.lastHarvest,
    lastCollectAttempt: durable.lastCollectAttemptAt,
    lastHarvestAttempt: durable.lastHarvestAttemptAt,
    lastCollectSuccess: durable.lastCollectSuccessAt,
    lastHarvestSuccess: durable.lastHarvestSuccessAt,
    lastD1WriteSuccess: durable.lastD1WriteSuccessAt,
    failedWrites: durable.failedWrites,
    failedHarvests: durable.failedHarvests,
    lastFailedCollect: durable.lastFailedCollectAt,
    lastFailedHarvest: durable.lastFailedHarvestAt,
    lastJob: durable.lastJob,
    lastManualCollectSuccess: durable.lastManualCollectSuccessAt,
    lastManualHarvestSuccess: durable.lastManualHarvestSuccessAt,
    lastScheduledCollectSuccess: durable.lastScheduledCollectSuccessAt,
    lastScheduledHarvestSuccess: durable.lastScheduledHarvestSuccessAt,
    lastScheduledCollectAttempt: durable.lastScheduledCollectAttemptAt,
    lastScheduledHarvestAttempt: durable.lastScheduledHarvestAttemptAt,
    scheduled: scheduledHealth(durable),
    scheduleWarnings: warnings,
    palPipeline: {
      configured: true,
      lastSuccess: meta.last_pal_success_at || null,
      lastFailure: meta.last_pal_error || null,
      httpStatus: meta.last_pal_http_status || null,
      recordsReturned: meta.last_pal_records_returned != null ? Number(meta.last_pal_records_returned) : null,
      usable: meta.last_pal_usable != null ? Number(meta.last_pal_usable) : null,
      matched: meta.last_pal_matched != null ? Number(meta.last_pal_matched) : null,
      unmatched: meta.last_pal_unmatched != null ? Number(meta.last_pal_unmatched) : null,
      ambiguous: meta.last_pal_ambiguous != null ? Number(meta.last_pal_ambiguous) : null,
      persisted: meta.last_pal_persisted != null ? Number(meta.last_pal_persisted) : null,
      mlbGames: meta.last_pal_mlb_games != null ? Number(meta.last_pal_mlb_games) : null,
      asOf: meta.last_pal_as_of || null,
      requestId: meta.last_pal_request_id || null,
      reason: meta.last_pal_reason || null,
      lastAttemptAt: meta.last_pal_attempt_at || null,
      lastAttemptHttpStatus: meta.last_pal_attempt_http_status || null,
      lastAttemptError: meta.last_pal_attempt_error || null,
      availableFromCache: Boolean(meta.last_pal_success_at && meta.last_pal_attempt_http_status === "429"),
    },
    processLocal: researchHealth(),
  };
}

export function collectDatesForSport(sport, today, dayOffset) {
  if (dayOffset != null && dayOffset !== "" && Number.isFinite(Number(dayOffset))) {
    return [shiftDateCT(today, Number(dayOffset))];
  }
  const dayList = [today, shiftDateCT(today, 1)];
  if (sport === "cfb" || sport === "nfl") {
    dayList.unshift(shiftDateCT(today, -1));
    dayList.push(shiftDateCT(today, 2));
  }
  return [...new Set(dayList)];
}

/** Pal network and SYS health belong on the operator CT day, not tomorrow's quota/401 clobber. */
export function shouldFetchPalNetwork(sport, day, operatorDay, { healthMode = false, dayOffset = null } = {}) {
  if (healthMode) return false;
  if (sport !== "mlb") return false;
  if (dayOffset != null && dayOffset !== "" && Number.isFinite(Number(dayOffset))) return true;
  return day === operatorDay;
}

export function shouldRecordPalHealth(day, operatorDay, { healthMode = false, dayOffset = null } = {}) {
  if (healthMode) return false;
  if (dayOffset != null && dayOffset !== "" && Number.isFinite(Number(dayOffset))) return true;
  return day === operatorDay;
}

export function sportsForJob(sport) {
  if (!sport || sport === "all") return [...BOARD_SPORTS];
  const id = String(sport).toLowerCase();
  if (!BOARD_SPORTS.includes(id)) return null;
  return [id];
}

export async function harvestAll(days, env = {}, opts = {}) {
  const attemptedAt = new Date().toISOString();
  await stampAttempt(env, "harvest", attemptedAt, opts.trigger || "http");
  const unbound = !hasDb(env);
  const sportList = sportsForJob(opts.sport);
  if (!sportList) {
    const payload = jobPayload({
      ok: false,
      job: "harvest",
      status: JOB_FAILED,
      attemptedAt,
      successfulAt: null,
      sports: [],
      dates: [],
      gamesDiscovered: 0,
      writes: emptyWriteCounts(),
      finals: { discovered: 0, graded: 0, failed: 0 },
      d1: await dbPayload(env),
      errors: [`unknown sport ${opts.sport}`],
      env,
    });
    await recordJob(env, {
      jobType: "harvest",
      triggerType: opts.trigger || "http",
      startedAt: attemptedAt,
      completedAt: new Date().toISOString(),
      status: JOB_FAILED,
      sport: String(opts.sport || "all"),
      errors: payload.errors,
    });
    return payload;
  }
  const reports = [];
  for (const sport of sportList) {
    try {
      reports.push(await harvestSport(sport, days, env, opts));
    } catch (err) {
      reports.push({
        sport,
        sportName: SPORTS[sport]?.name || sport,
        ok: false,
        error: String(err?.message || err),
        accuracy: accuracyOf([]),
        games: [],
        finals: [],
        errors: [String(err?.message || err)],
        jobCounts: emptyWriteCounts(),
        dates: lastNDatesCT(Math.max(1, Number(days) || 8)),
        recipe: RECIPE_GUIDE[sport],
      });
    }
  }
  const games = reports.flatMap((r) => r.games || []);
  const finals = reports.flatMap((r) => r.finals || []);
  const errors = reports.flatMap((r) => r.errors || (r.error ? [r.error] : []));
  let writes = emptyWriteCounts();
  for (const r of reports) writes = mergeWriteCounts(writes, r.jobCounts || emptyWriteCounts());
  const okSports = reports.filter((r) => r.ok !== false && !r.error).length;
  const failedSports = reports.length - okSports;
  const status = classifyJobStatus({
    okSports,
    failedSports,
    writesFailed: writes.writesFailed,
    unbound,
    requiredFailed: unbound || failedSports === reports.length,
  });
  const successfulAt = status === JOB_SUCCESS ? new Date().toISOString() : null;
  if (status === JOB_SUCCESS) await stampSuccess(env, "harvest", successfulAt, opts.trigger || "http");
  const payload = jobPayload({
    ok: status === JOB_SUCCESS,
    job: "harvest",
    status,
    attemptedAt,
    successfulAt,
    sports: reports.map((r) => ({
      sport: r.sport,
      sportName: r.sportName,
      ok: r.ok !== false && !r.error,
      accuracy: r.accuracy,
      error: r.error || (r.errors || [])[0] || null,
      games: r.gamesDiscovered ?? (r.games || []).length,
      recipe: r.recipe,
    })),
    dates: [...new Set(reports.flatMap((r) => r.dates || []))],
    gamesDiscovered: games.length,
    writes,
    finals: {
      discovered: reports.reduce((s, r) => s + (r.finalsDiscovered ?? (r.finals || []).length), 0),
      graded: reports.reduce((s, r) => s + (r.finalsGraded || 0), 0),
      failed: reports.reduce((s, r) => s + (r.finalsFailed || 0), 0),
      awaitingRetry: writes.writesFailed || 0,
    },
    d1: await dbPayload(env),
    errors,
    env,
    triggerType: opts.trigger || "http",
    cacheStatus: "accelerator-not-ledger",
  });
  await recordJob(env, {
    jobType: "harvest",
    triggerType: opts.trigger || "http",
    startedAt: attemptedAt,
    completedAt: new Date().toISOString(),
    successfulAt,
    status,
    sport: sportList.length === 1 ? sportList[0] : "all",
    dates: payload.dates,
    gamesDiscovered: payload.games_discovered,
    writesAttempted: writes.writesAttempted,
    writesSucceeded: writes.writesSucceeded,
    writesFailed: writes.writesFailed,
    projectionsGenerated: payload.games_discovered,
    writesAlready: writes.snapshotsAlready,
    immutableConflicts: writes.immutableConflicts,
    finalsDiscovered: payload.finals_discovered,
    finalsGraded: payload.finals_graded,
    finalsAwaitingRetry: payload.finals_awaiting_retry,
    errors,
  });
  return {
    ...payload,
    sport: sportList.length === 1 ? sportList[0] : "all",
    sportName: sportList.length === 1 ? SPORTS[sportList[0]]?.name || sportList[0] : "All boards",
    generatedAt: payload.attempted_at,
    harvestedAt: successfulAt,
    days: Number(days) || 8,
    recipeGuide: RECIPE_GUIDE,
    accuracy: accuracyOf(games),
    games,
    finals,
    daily: reports.map((r) => r.daily).filter(Boolean),
    db: payload.d1,
  };
}

export async function collectBoards(env = {}, { odds = "cache", trigger = "http", buildSlateFn, sport, dayOffset, mode } = {}) {
  const healthMode = mode === "health";
  const attemptedAt = new Date().toISOString();
  await stampAttempt(env, "collect", attemptedAt, trigger);
  const date = todayCT();
  const builder = buildSlateFn || buildSlate;
  const sports = [];
  const errors = [];
  let writes = emptyWriteCounts();
  let gamesDiscovered = 0;
  const dates = [];
  const unbound = !hasDb(env);
  const sportList = sportsForJob(sport);
  if (!sportList) {
    const payload = jobPayload({
      ok: false,
      job: odds === "full" ? "collect-full" : "collect-cache",
      status: JOB_FAILED,
      attemptedAt,
      successfulAt: null,
      sports: [],
      dates: [],
      gamesDiscovered: 0,
      writes: emptyWriteCounts(),
      finals: { discovered: 0, graded: 0, failed: 0 },
      d1: await dbPayload(env),
      errors: [`unknown sport ${sport}`],
      env,
    });
    await recordJob(env, {
      jobType: payload.job,
      triggerType: trigger,
      startedAt: attemptedAt,
      completedAt: new Date().toISOString(),
      status: JOB_FAILED,
      sport: String(sport),
      errors: payload.errors,
    });
    return { ...payload, date, odds, db: payload.d1 };
  }

  for (const sport of sportList) {
    const unique = collectDatesForSport(sport, date, dayOffset);
    try {
      let n = 0;
      let pal = null;
      const days = [];
      let sportWrites = emptyWriteCounts();
      const sportFailReasons = [];
      for (const day of unique) {
        dates.push(day);
        const slate = await builder(sport, day, {
          ...env,
          parlayCacheOnly: odds !== "full" || healthMode,
          palCacheOnly: !shouldFetchPalNetwork(sport, day, date, { healthMode, dayOffset }),
        });
        if (!healthMode && odds === "full" && slate?.parlay?.error) {
          throw new Error(`Parlay full collect failed: ${slate.parlay.error}`);
        }
        let frozen = { counts: emptyWriteCounts(), failReasons: [] };
        if (!healthMode) {
          frozen = await freezeSlate(slate, env);
        }
        sportWrites = mergeWriteCounts(sportWrites, frozen.counts || emptyWriteCounts());
        if (frozen.failReasons?.length) sportFailReasons.push(...frozen.failReasons);
        n += slate.games?.length || 0;
        pal = slate.pal?.match || slate.pal?.meta || slate.pal || pal;
        if (sport === "mlb" && shouldRecordPalHealth(day, date, { healthMode, dayOffset })) {
          const palMeta = slate.pal?.meta || slate.pal || {};
          const palMatch = slate.pal?.match || {};
          const persisted = (slate.games || []).filter((g) => g.bpp?.homeRuns != null || g.bpp?.awayRuns != null).length;
          await setMeta(env, "last_pal_attempt_at", new Date().toISOString());
          await setMeta(env, "last_pal_attempt_http_status", palHttpStatusToStore(palMeta));
          await setMeta(env, "last_pal_attempt_error", palMeta.error || palMeta.reason || "");
          if (palMeta.error || palMeta.reason === "upstream-error") {
            await setMeta(env, "last_pal_error", palMeta.error || palMeta.reason);
            await setMeta(env, "last_pal_http_status", palHttpStatusToStore(palMeta));
          } else if (palMeta.enabled === false) {
            await setMeta(env, "last_pal_error", palMeta.reason || "no-api-key");
            const noKeyStatus = palHttpStatusToStore(palMeta);
            if (noKeyStatus) await setMeta(env, "last_pal_http_status", noKeyStatus);
          } else {
            if (palMeta.reason === "no-records-returned" || palMeta.recordsReturned === 0) {
              await setMeta(env, "last_pal_error", palMeta.reason || "no-records-returned");
            } else {
              await setMeta(env, "last_pal_error", "");
              await setMeta(env, "last_pal_success_at", palMeta.asOf || new Date().toISOString());
            }
            await setMeta(env, "last_pal_request_id", palMeta.requestId || "");
            await setMeta(env, "last_pal_as_of", palMeta.asOf || "");
            await setMeta(env, "last_pal_http_status", palHttpStatusToStore(palMeta));
          }
          const matched = palMatch.matched ?? (slate.games || []).filter((g) => g.bpp).length;
          const unmatched = palMatch.unmatched ?? Math.max(0, (slate.games || []).length - matched);
          const ambiguous = palMatch.ambiguous ?? 0;
          const returned = palMeta.recordsReturned ?? palMatch.palRecords ?? 0;
          const usable = palMeta.usable ?? palMatch.palUsable ?? 0;
          const successfulCurrent = !palMeta.error && palMeta.reason !== "upstream-error" && Number(returned) > 0;
          if (successfulCurrent) {
            await setMeta(env, "last_pal_matched", String(matched));
            await setMeta(env, "last_pal_unmatched", String(unmatched));
            await setMeta(env, "last_pal_ambiguous", String(ambiguous));
            await setMeta(env, "last_pal_records_returned", String(returned));
            await setMeta(env, "last_pal_usable", String(usable));
            await setMeta(env, "last_pal_persisted", String(persisted));
            await setMeta(env, "last_pal_mlb_games", String((slate.games || []).length));
            await setMeta(env, "last_pal_reason", "");
          }
          pal = {
            ...(typeof pal === "object" && pal ? pal : {}),
            ...palMeta,
            ...palMatch,
            persisted,
            unmatchedSample: Array.isArray(slate.pal?.unmatchedSample)
              ? slate.pal.unmatchedSample.slice(0, 8)
              : Array.isArray(slate.pal?.unmatched)
                ? slate.pal.unmatched.slice(0, 8)
                : [],
          };
        }
        days.push({ date: day, n: slate.games?.length || 0 });
      }
      writes = mergeWriteCounts(writes, sportWrites);
      gamesDiscovered += n;
      sports.push({
        sport,
        ok: sportWrites.writesFailed === 0,
        n,
        date,
        dates: days,
        pal,
        writes: sportWrites,
      });
      if (sportWrites.writesFailed) {
        const reasons = [...new Set(sportFailReasons.filter(Boolean))];
        errors.push(
          `${sport}: ${sportWrites.writesFailed} D1 writes failed${reasons.length ? ` (${reasons.join("; ")})` : ""}`
        );
      }
    } catch (err) {
      const msg = String(err?.message || err);
      errors.push(`${sport}: ${msg}`);
      sports.push({ sport, ok: false, error: msg });
    }
  }

  const okSports = sports.filter((s) => s.ok).length;
  const failedSports = sports.length - okSports;
  const status = classifyJobStatus({
    okSports,
    failedSports,
    writesFailed: writes.writesFailed,
    unbound,
    requiredFailed: unbound || failedSports === sports.length,
  });
  const successfulAt = status === JOB_SUCCESS ? new Date().toISOString() : null;
  if (status === JOB_SUCCESS) await stampSuccess(env, "collect", successfulAt, trigger);
  else if (failedSports === sports.length) await setMeta(env, "last_collect_error_at", attemptedAt);

  const payload = jobPayload({
    ok: status === JOB_SUCCESS,
    job: healthMode ? "health" : odds === "full" ? "collect-full" : "collect-cache",
    status,
    triggerType: trigger,
    attemptedAt,
    successfulAt,
    sports,
    dates: [...new Set(dates)],
    gamesDiscovered,
    writes,
    finals: { discovered: 0, graded: 0, failed: 0 },
    d1: await dbPayload(env),
    errors: odds === "cache" ? [...errors, ...(errors.some((e) => /pinnacle|parlay/i.test(e)) ? [] : [])] : errors,
    env,
    cacheStatus: healthMode ? "health-cache-only" : odds === "full" ? "full-parlay" : "cache-only-odds",
  });
  await recordJob(env, {
    jobType: payload.job,
    triggerType: trigger,
    startedAt: attemptedAt,
    completedAt: new Date().toISOString(),
    status,
    sport: sportList.length === 1 ? sportList[0] : "all",
    dates: payload.dates,
    gamesDiscovered,
    writesAttempted: writes.writesAttempted,
    writesSucceeded: writes.writesSucceeded,
    writesFailed: writes.writesFailed,
    projectionsGenerated: gamesDiscovered,
    writesAlready: writes.snapshotsAlready,
    immutableConflicts: writes.immutableConflicts,
    errors,
  });
  return { ...payload, date, odds, db: payload.d1 };
}

async function loadCacheRows(sport, since, env) {
  const sports = !sport || sport === "all" ? BOARD_SPORTS : [sport];
  const rows = [];
  for (const s of sports) {
    const ledger = await loadLedger(s, env.caches);
    for (const row of flattenLedgerRows(ledger)) {
      if (!since || row.date >= since) rows.push(row);
    }
  }
  return rows;
}

export async function buildTrackReport(sport, days, env = {}, opts = {}) {
  const checkpoint = opts.checkpoint || "LATEST";
  const version = opts.version || "all";
  const model = opts.model || "ensemble";
  const perGame = opts.type !== "totals";
  const year = opts.year || null;
  const lastN = days === "50" || days === "100" ? Number(days) : null;
  const since = year
    ? sport === "cfb" || sport === "nfl"
      ? `${year}-08-01`
      : `${year}-03-01`
    : lastN
      ? lastNDatesCT(180).at(-1)
      : windowStart(days, sport === "all" ? "mlb" : sport);
  const until = year ? `${year}-12-20` : null;
  const aggregateEligible =
    (days === "season" || days === "lifetime") &&
    checkpoint === "LATEST" &&
    !opts.team &&
    !lastN &&
    (opts.type === "totals" || sport === "all") &&
    (version === "all" || !version);

  if (aggregateEligible) {
    const aggQ = await queryDailyMetrics(env, {
      sport,
      since,
      until,
      checkpoint: "LATEST",
      modelVersion: version || "all",
    });
    if (aggQ.ok && (aggQ.rows || []).length) {
      return buildAggregateTrackReport({
        sport,
        days,
        since,
        until,
        version,
        checkpoint,
        model,
        rows: aggQ.rows,
        env,
      });
    }
  }

  const db = await pingDb(env);
  let source = "d1";
  let q = await querySnapshots(env, {
    sport,
    since,
    until,
    version,
    checkpoint: checkpoint === "LATEST" ? null : checkpoint,
  });
  let rows = q.rows || [];
  if (!q.ok) {
    source = "cache";
    rows = await loadCacheRows(sport, since, env);
  } else if (!rows.length) {
    const pred = await queryPredictions(env, { sport, since, until, version });
    if (pred.ok && pred.rows.length) {
      rows = pred.rows;
      source = "d1-predictions";
    } else {
      const fallback = await loadCacheRows(sport, since, env);
      if (fallback.length) {
        rows = fallback;
        source = "d1-empty-cache-fallback";
      }
    }
  }
  if (until) rows = rows.filter((r) => r.date <= until);
  if (version && version !== "all") rows = rows.filter((r) => r.modelVersion === version);
  if (checkpoint && checkpoint !== "LATEST") rows = rowsForCheckpoint(rows, checkpoint);
  if (opts.team) {
    const t = String(opts.team).toLowerCase();
    rows = rows.filter(
      (r) =>
        String(r.homeAbbr || "").toLowerCase() === t ||
        String(r.awayAbbr || "").toLowerCase() === t ||
        String(r.matchup || "").toLowerCase().includes(t)
    );
  }

  const snapshotRows = rows;
  let displayRows = checkpoint === "LATEST" ? pickCanonical(rows) : rows;
  if (lastN) {
    displayRows = [...displayRows]
      .filter((r) => r.actualHome != null)
      .sort((a, b) => String(b.date).localeCompare(a.date) || String(b.frozenAt || "").localeCompare(a.frozenAt || ""))
      .slice(0, lastN);
  }
  const acc = accuracyOf(displayRows);
  const pack = buildAccuracyPack(displayRows, { model, perGame, sport: sport === "all" ? null : sport });
  const tickets = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id });
  const over = overDiagnostics(displayRows, { tickets });
  const health = await dbPayload(env);
  const distinctProjected = new Set(
    snapshotRows.filter((r) => r.projHome != null && r.projAway != null).map((r) => `${r.date}:${r.id}`)
  ).size;
  const distinctGraded = new Set(
    snapshotRows.filter((r) => r.actualHome != null && r.actualAway != null).map((r) => `${r.date}:${r.id}`)
  ).size;
  const displayProjected = displayRows.filter((r) => r.projHome != null).length;
  const displayGraded = displayRows.filter((r) => r.actualHome != null).length;
  const mlbRows = displayRows.filter((r) => r.sport === "mlb");
  const mlbAcc = accuracyOf(mlbRows);
  const coverage = sourceCoverage(displayRows);
  const palMeta = {
    lastSuccess: health.lastCollectSuccess,
    error: null,
    asOf: displayRows.find((r) => r.palAsOf)?.palAsOf || null,
    requestId: displayRows.find((r) => r.palRequestId)?.palRequestId || null,
    enabled: true,
  };
  const oddsQ = await queryOddsSnapshots(env, { sport: sport === "all" ? null : sport, since });
  const byGame = {};
  for (const r of oddsQ.rows || []) {
    if (!byGame[r.gameId]) byGame[r.gameId] = [];
    byGame[r.gameId].push(r);
  }
  const prospective = (tickets || []).filter((t) => t.role === "prospective" || t.role !== "seed");
  const clv = clvTracker(prospective, byGame);
  const close = closeCoverage(prospective, byGame);
  const layers = layerDiagnostics(displayRows);
  const strat = strategyStats(prospective);
  const settledN = prospective.filter((t) => t.result === "WON" || t.result === "LOST").length;
  const strategyPerformance = {
    tickets: prospective.length,
    open: prospective.filter((t) => !t.result || t.result === "OPEN").length,
    settled: settledN,
    record: settledN ? `${strat.wins}-${strat.losses}` : null,
    hitRate: settledN ? strat.hitRate : null,
    units: settledN && strat.units != null ? strat.units : null,
    roi: settledN && strat.roi != null ? strat.roi : null,
    avgEv: strat.avgEv ?? null,
    avgClv: clv.unavailable ? null : clv.avg,
    message: settledN ? null : "No settled strategy tickets yet.",
  };
  const pal = palHealth(mlbRows.length ? mlbRows : displayRows.filter((r) => r.sport === "mlb"), palMeta);
  const accSummary = {
    label: "Projection Accuracy",
    source: "D1 immutable snapshots",
    sport: sport === "all" ? "all" : sport,
    checkpoint,
    modelVersion: version === "all" ? (displayRows[0]?.modelVersion || MODEL_VERSION) : version,
    dateRange: { since, until: until || todayCT() },
    distinctProjected,
    distinctGraded,
    ungraded: Math.max(0, distinctProjected - distinctGraded),
    checkpointRows: snapshotRows.length,
    gradingCoverage: distinctProjected ? distinctGraded / distinctProjected : null,
    n: acc.n,
    maeTotal: acc.maeTotal,
    biasTotal: acc.biasTotal,
    winnerHit: acc.winnerHitProb ?? acc.winnerHit,
    brier: acc.brierModel,
  };
  const reports = await queryDailyReports(env, { sport, since });
  const quota = await queryQuota(env);
  const storage = await storageBudget(env);
  const keyHealth = collegeKeyHealth(env);
  const byCheckpoint = {};
  for (const cp of CHECKPOINTS) {
    byCheckpoint[cp] = accuracyOf(rowsForCheckpoint(snapshotRows, cp));
  }
  const versions = [...new Set([...(await queryVersions(env)), ...displayRows.map((r) => r.modelVersion).filter(Boolean)])];
  const sports = (!sport || sport === "all" ? BOARD_SPORTS : [sport]).map((id) => {
    const xs = displayRows.filter((r) => r.sport === id);
    return {
      sport: id,
      sportName: SPORTS[id]?.name || id,
      accuracy: accuracyOf(xs),
      recipe: RECIPE_GUIDE[id],
    };
  });
  const counts = await countToday(env, todayCT());
  const decoratedGames = displayRows
    .map(decorateRow)
    .sort((a, b) => String(b.date).localeCompare(a.date) || String(a.matchupDisplay || a.matchup || "").localeCompare(String(b.matchupDisplay || b.matchup || "")));
  return {
    sport: sport || "all",
    sportName: !sport || sport === "all" ? "All boards" : SPORTS[sport]?.name || sport,
    generatedAt: new Date().toISOString(),
    harvestedAt: new Date().toISOString(),
    days,
    checkpoint,
    version,
    model,
    type: perGame ? "perGame" : "totals",
    source,
    recipeGuide: RECIPE_GUIDE,
    sports,
    accuracy: acc,
    accuracySummary: accSummary,
    pack,
    over,
    coverage,
    clv,
    closeCoverage: close,
    layers,
    strategyPerformance,
    pal,
    mlbAccuracy: mlbAcc,
    distinct: {
      projected: distinctProjected,
      graded: distinctGraded,
      displayProjected,
      displayGraded,
      checkpointRows: snapshotRows.length,
    },
    dailyReports: reports,
    byCheckpoint,
    versions,
    games: decoratedGames,
    finals: displayRows.filter((r) => r.actualHome != null).map((r) => ({
      id: r.id,
      sport: r.sport,
      date: r.date,
      home: {
        name: canonicalTeamLabel(r.sport, r.homeName, r.homeAbbr) || r.homeName,
        abbr: r.homeAbbr,
        score: r.actualHome,
      },
      away: {
        name: canonicalTeamLabel(r.sport, r.awayName, r.awayAbbr) || r.awayName,
        abbr: r.awayAbbr,
        score: r.actualAway,
      },
      matchupDisplay: canonicalMatchupDisplay(r).matchupDisplay,
      status: { completed: true },
    })),
    db: {
      ...health,
      ...counts,
      source: health.healthSource || source,
      healthSource: health.healthSource || "d1",
      lastError: health.lastError || db.lastError || researchHealth().lastError,
      college: {
        keys: keyHealth,
        quota,
        storage,
        note: "Shadow CFB/CBB models cannot QUALIFY, LOG, or write strategy tickets. N=0 metrics are unavailable, not 0.0%.",
      },
    },
  };
}

function weighted(rows, key) {
  let n = 0;
  let w = 0;
  for (const r of rows || []) {
    const v = Number(r?.[key]);
    const rn = Number(r?.n) || 0;
    if (!Number.isFinite(v) || rn <= 0) continue;
    n += rn;
    w += v * rn;
  }
  return n > 0 ? w / n : null;
}

function aggregateFromDaily(rows = []) {
  const n = rows.reduce((s, r) => s + (Number(r?.n) || 0), 0);
  return {
    n,
    maeTotal: weighted(rows, "maeTotal"),
    maeMargin: weighted(rows, "maeMargin"),
    brierModel: weighted(rows, "brier"),
    logLossModel: weighted(rows, "logLoss"),
    winnerHitProb: weighted(rows, "winnerHit"),
    winnerHit: weighted(rows, "winnerHit"),
    winnerHitScore: weighted(rows, "winnerHit"),
    biasTotal: null,
  };
}

async function buildAggregateTrackReport({
  sport,
  days,
  since,
  until,
  version,
  checkpoint,
  model,
  rows,
  env,
}) {
  const acc = aggregateFromDaily(rows);
  const bySport = {};
  for (const r of rows || []) {
    if (!bySport[r.sport]) bySport[r.sport] = [];
    bySport[r.sport].push(r);
  }
  const sports = (!sport || sport === "all" ? BOARD_SPORTS : [sport]).map((id) => ({
    sport: id,
    sportName: SPORTS[id]?.name || id,
    accuracy: aggregateFromDaily(bySport[id] || []),
    recipe: RECIPE_GUIDE[id],
  }));
  const health = await dbPayload(env);
  const counts = await countToday(env, todayCT());
  const reports = await queryDailyReports(env, { sport, since });
  const versions = [...new Set((rows || []).map((r) => r.modelVersion).filter(Boolean))];
  const tableRows = [
    { key: "mae_total", label: "Total MAE", n: acc.n, value: acc.maeTotal },
    { key: "mae_margin", label: "Margin MAE", n: acc.n, value: acc.maeMargin },
    { key: "winner_hit", label: "Winner hit", n: acc.n, value: acc.winnerHit },
    { key: "brier", label: "Brier", n: acc.n, value: acc.brierModel },
    { key: "log_loss", label: "Log loss", n: acc.n, value: acc.logLossModel },
  ];
  return {
    sport: sport || "all",
    sportName: !sport || sport === "all" ? "All boards" : SPORTS[sport]?.name || sport,
    generatedAt: new Date().toISOString(),
    harvestedAt: new Date().toISOString(),
    days,
    checkpoint,
    version,
    model,
    type: "totals",
    source: "d1-daily-metrics",
    aggregateOnly: true,
    recipeGuide: RECIPE_GUIDE,
    sports,
    accuracy: acc,
    accuracySummary: {
      label: "Projection Accuracy",
      source: "D1 daily_metrics aggregate",
      sport: sport || "all",
      checkpoint,
      modelVersion: version === "all" ? (versions[0] || MODEL_VERSION) : version,
      dateRange: { since, until: until || todayCT() },
      distinctProjected: null,
      distinctGraded: acc.n,
      ungraded: null,
      checkpointRows: rows.length,
      gradingCoverage: null,
      n: acc.n,
      maeTotal: acc.maeTotal,
      biasTotal: null,
      winnerHit: acc.winnerHit,
      brier: acc.brierModel,
    },
    pack: {
      table: {
        headline: {
          n: acc.n,
          mae: acc.maeTotal,
          rmse: null,
          medianAbs: null,
          pctDiff: null,
          diff: null,
        },
        rows: tableRows,
      },
      distribution: {},
      models: [],
      breakdowns: {
        day: (rows || []).slice(0, 45).map((r) => ({
          key: `${r.date}:${r.sport}`,
          label: `${r.date} ${String(r.sport || "").toUpperCase()}`,
          n: r.n,
          mae: r.maeTotal,
          brier: r.brier,
          winner: r.winnerHit,
        })),
      },
    },
    over: null,
    coverage: sourceCoverage([]),
    clv: { unavailable: true, n: 0, avg: null, byMarket: [], bySport: [] },
    closeCoverage: { n: 0, missing: 0, share: null, byMarket: [] },
    layers: {},
    strategyPerformance: {
      tickets: 0,
      open: 0,
      settled: 0,
      record: null,
      hitRate: null,
      units: null,
      roi: null,
      avgEv: null,
      avgClv: null,
      message: "Aggregate SYS mode omits ticket-level slices.",
    },
    pal: palHealth([], { enabled: true, asOf: null }),
    mlbAccuracy: aggregateFromDaily(bySport.mlb || []),
    distinct: {
      projected: null,
      graded: acc.n,
      displayProjected: null,
      displayGraded: acc.n,
      checkpointRows: rows.length,
    },
    dailyReports: reports,
    byCheckpoint: { LATEST: acc },
    versions,
    games: [],
    finals: [],
    db: {
      ...health,
      ...counts,
      source: "d1",
      healthSource: health.healthSource || "d1",
      aggregateMode: true,
      aggregateRows: rows.length,
    },
  };
}
