/**
 * Frozen projection ledger. Snapshot pregame scores, then grade vs finals.
 * Harvest uses scoreboards only — never Parlay — so nightly grading is free.
 */

import { readCache, writeCache } from "./cache.js";
import { namesMatch } from "./parlay.js";
import { BOARD_SPORTS, SPORTS, lastNDatesCT, todayCT, fetchResults, blendWinProb, buildSlate } from "./slateEngine.js";
import { DEFAULT_WEIGHTS, MODEL_VERSION } from "./weights.js";
import { brierScore, logLoss } from "./pricing.js";
import {
  persistGame,
  persistOddsSnapshot,
  persistPrediction,
  persistSnapshot,
  persistDailyMetrics,
  pingDb,
  querySnapshots,
  queryPredictions,
  queryVersions,
  countToday,
  researchHealth,
} from "./store.js";
import { classifyCheckpoint, materiallyChanged, pickCanonical, snapshotKey, CHECKPOINTS } from "./checkpoints.js";
import { buildAccuracyPack } from "./accuracyReport.js";

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
    engine: "Pinnacle line-implied",
    body: "Same split as NBA: Pinnacle total and spread implied into team scores. Recs blend no-vig market, ESPN, and record form.",
  },
  cfb: {
    engine: "Pinnacle line-implied",
    body: "Pinnacle total/spread split into team scores. Wider gates than the NFL because the market is noisier.",
  },
  cbb: {
    engine: "Pinnacle line-implied",
    body: "Pinnacle total/spread split into team scores. ESPN win% is a real layer on this board.",
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
    matchup: `${game.away?.abbr || "A"} @ ${game.home?.abbr || "H"}`,
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
    qualityFlags: game.quality?.flags || [],
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
    palTotals: game.bpp?.totals || null,
    palPHomeStored: game.bpp?.pHome ?? null,
    lineupsOfficial: Boolean(game.bpp?.lineupsOfficial),
    park: game.venue || game.park?.name || "",
    homeSp: game.homeSp?.name || game.homeSp?.last || null,
    awaySp: game.awaySp?.name || game.awaySp?.last || null,
    f5HomeWin: game.bpp?.f5?.homeWin ?? null,
    f5AwayWin: game.bpp?.f5?.awayWin ?? null,
    f5ActualAway: null,
    f5ActualHome: null,
  };
}

function applyFinal(row, final) {
  const hs = Number(final.home?.score);
  const as = Number(final.away?.score);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return row;
  if (!final.status?.completed) return row;
  const lastSnap = (row.snapshots || []).at(-1) || null;
  const next = {
    ...row,
    actualHome: hs,
    actualAway: as,
    actualTotal: hs + as,
    gradedAt: row.gradedAt || new Date().toISOString(),
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
  if (snap.pinHomeMl == null && snap.pinAwayMl == null) return row;
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
  const snapshots = [...(row.snapshots || []), snap];
  return {
    ...row,
    snapshots,
    closePinHomeMl: snap.pinHomeMl,
    closePinAwayMl: snap.pinAwayMl,
    closeNoVigHome: snap.noVigHome,
  };
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
  const abs = (a, b) => Math.abs(a - b);
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
  return {
    n,
    maeHome: mean(homeErrs.map(Math.abs)),
    maeAway: mean(awayErrs.map(Math.abs)),
    maeTeam: mean(teamErrs.map(Math.abs)),
    maeTotal: mean(totErrs.map(Math.abs)),
    maeMargin: mean(mgnErrs.map(Math.abs)),
    rmseTotal: totErrs.length ? Math.sqrt(mean(totErrs.map((e) => e ** 2))) : null,
    biasTotal: mean(totErrs),
    winnerHit: decidedScore.length ? winnerHits / decidedScore.length : null,
    winnerHitScore: decidedScore.length ? winnerHits / decidedScore.length : null,
    winnerHitProb: probDecided.length ? probHits / probDecided.length : null,
    brierModel: brier(pKey),
    brierMarket: brier((r) => r.impliedHome ?? r.pMarket),
    brierPal: brier((r) => r.pPal),
    brierScore: brier((r) => r.pScore),
    logLossModel: ll(pKey),
    logLossMarket: ll((r) => r.impliedHome ?? r.pMarket),
    logLossPal: ll((r) => r.pPal),
    withinTeam05: share(teamErrs, 0.5),
    withinTeam1: share(teamErrs, 1),
    withinTeam2: share(teamErrs, 2),
    withinTotal05: share(totErrs, 0.5),
    withinTotal1: share(totErrs, 1),
    withinTotal2: share(totErrs, 2),
    withinTotal3: share(totErrs, 3),
    withinTotal4: share(totErrs, 4),
    withinMargin1: share(mgnErrs, 1),
    withinMargin2: share(mgnErrs, 2),
    withinMargin3: share(mgnErrs, 3),
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

export function decorateRow(row) {
  if (row.actualHome == null || row.projHome == null) {
    return { ...row, errHome: null, errAway: null, errTotal: null, errMargin: null, status: row.projHome == null ? "NO_PROJ" : "OPEN" };
  }
  return {
    ...row,
    errHome: row.projHome - row.actualHome,
    errAway: row.projAway - row.actualAway,
    errTotal: row.projTotal - row.actualTotal,
    errMargin: row.projMargin - (row.actualHome - row.actualAway),
    status: "GRADED",
  };
}

export async function freezeSlate(slate, env = {}) {
  if (!slate?.sport || !slate.games) return;
  const cfCache = env.caches;
  const ledger = await loadLedger(slate.sport, cfCache);
  let changed = false;
  const writes = [];
  for (const game of slate.games) {
    const k = rowKey(slate.date, game.id);
    const existing = ledger.games[k];
    const liveOrFinal = Boolean(game.status?.live || game.status?.completed);

    if (!existing && !liveOrFinal) {
      const frozen = freezeFromGame(slate.date, game);
      if (frozen) {
        frozen.checkpoints = { [frozen.checkpoint]: { ...frozen } };
        ledger.games[k] = frozen;
        changed = true;
        writes.push(persistFrozen(env, frozen, game, slate.date));
        writes.push(persistCheckpoint(env, frozen, game, slate.date));
      }
      continue;
    }

    if (existing && !liveOrFinal) {
      let next = appendSnapshot(existing, game);
      const packed = freezeFromGame(slate.date, game);
      if (packed) {
        const cps = { ...(next.checkpoints || {}) };
        const prevCp = cps[packed.checkpoint];
        if (!prevCp || materiallyChanged(prevCp, packed)) {
          cps[packed.checkpoint] = { ...packed, actualHome: next.actualHome, actualAway: next.actualAway };
          next = { ...next, checkpoints: cps, checkpoint: packed.checkpoint };
          writes.push(persistCheckpoint(env, cps[packed.checkpoint], game, slate.date));
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
        writes.push(persistSnap(env, next, slate.date));
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
    }
  }
  await Promise.all(writes);
  if (changed) await saveLedger(slate.sport, ledger, cfCache);
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
    asOf: row.palAsOf,
    requestId: row.palRequestId,
    lineupsOfficial: row.lineupsOfficial,
    park: row.park || "",
    homeSp: row.homeSp || null,
    awaySp: row.awaySp || null,
    homeAbbr: row.homeAbbr || null,
    awayAbbr: row.awayAbbr || null,
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
  await persistGame(env, game || stubGame(row), date);
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
  });
  await persistSnap(env, row, date);
}

async function persistCheckpoint(env, row, game, date) {
  if (!row?.checkpoint) return { ok: false, reason: "no-checkpoint" };
  await persistGame(env, game || stubGame(row), date || row.date);
  return persistSnapshot(env, {
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
  });
}

async function persistSnap(env, row, date) {
  const snap = (row.snapshots || []).at(-1);
  if (!snap) return { ok: false, reason: "no-odds" };
  return persistOddsSnapshot(env, {
    gameId: row.id,
    sport: row.sport,
    date,
    book: "Pinnacle",
    market: "ml",
    side: "HOME",
    line: null,
    price: snap.pinHomeMl,
    implied: null,
    noVig: snap.noVigHome,
    capturedAt: snap.at,
  });
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
  await Promise.all(jobs);
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

export async function harvestSport(sport, days, env = {}) {
  const cfCache = env.caches;
  const n = Math.max(1, Math.min(Number(days) || 8, KEEP_DAYS));
  const harvestKey = `${CACHE_VER}:harvest:${sport}:${n}`;
  const cached = await readCache(harvestKey, cfCache, HARVEST_TTL_MS);
  const ledger = await loadLedger(sport, cfCache);
  const dates = lastNDatesCT(n);
  const finals = [];

  if (cached?.finals && cached.ledgerSavedAt === ledger.savedAt) {
    await persistGradedLedger(env, ledger);
    await writeDailyMetrics(env, flattenLedgerRows(ledger));
    return { ...cached, db: await dbPayload(env) };
  }

  const writes = [];
  for (const date of dates) {
    try {
      const results = await fetchResults(sport, date);
      for (const g of results) finals.push({ ...g, date });
      for (const g of results) {
        const k = rowKey(date, g.id);
        const existing =
          ledger.games[k] ||
          Object.values(ledger.games).find((row) => row.date === date && matchFinal(row, [g]));
        if (existing && g.status?.completed && existing.actualHome == null) {
          const next = applyFinal(existing, g);
          ledger.games[existing.date + ":" + existing.id] = next;
          writes.push(persistFrozen(env, next, g, date));
          for (const cp of Object.values(next.checkpoints || { [next.checkpoint || "CLOSE"]: next })) {
            writes.push(persistCheckpoint(env, { ...next, ...cp, id: next.id, date: next.date }, g, date));
          }
        }
      }
    } catch {
      /* one date failing should not kill the harvest */
    }
  }
  await Promise.all(writes);

  const saved = await saveLedger(sport, ledger, cfCache);
  await persistGradedLedger(env, saved);
  await writeDailyMetrics(env, flattenLedgerRows(saved));
  const rows = Object.values(saved.games)
    .filter((r) => r.sport === sport || !r.sport)
    .sort((a, b) => String(b.date).localeCompare(a.date) || String(a.matchup).localeCompare(b.matchup))
    .map(decorateRow);
  const report = {
    sport,
    sportName: SPORTS[sport]?.name || sport,
    generatedAt: new Date().toISOString(),
    harvestedAt: new Date().toISOString(),
    days: n,
    recipe: RECIPE_GUIDE[sport] || null,
    accuracy: accuracyOf(rows),
    games: rows,
    finals: finals.filter((g) => g.status?.completed).map((g) => ({
      id: g.id,
      sport,
      date: g.date,
      home: g.home,
      away: g.away,
      status: g.status,
      f5Score: g.f5Score,
    })),
    ledgerSavedAt: saved.savedAt,
    db: await dbPayload(env),
  };
  await writeCache(harvestKey, report, cfCache, HARVEST_TTL_MS);
  return report;
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
  return { ...ping, ...counts, ...researchHealth() };
}

export async function harvestAll(days, env = {}) {
  const reports = await Promise.all(
    BOARD_SPORTS.map(async (sport) => {
      try {
        return await harvestSport(sport, days, env);
      } catch (err) {
        return {
          sport,
          sportName: SPORTS[sport]?.name || sport,
          error: String(err?.message || err),
          accuracy: accuracyOf([]),
          games: [],
          finals: [],
          recipe: RECIPE_GUIDE[sport],
        };
      }
    })
  );
  const games = reports.flatMap((r) => r.games || []);
  const finals = reports.flatMap((r) => r.finals || []);
  return {
    sport: "all",
    sportName: "All boards",
    generatedAt: new Date().toISOString(),
    harvestedAt: new Date().toISOString(),
    days: Number(days) || 8,
    recipeGuide: RECIPE_GUIDE,
    sports: reports.map((r) => ({
      sport: r.sport,
      sportName: r.sportName,
      accuracy: r.accuracy,
      error: r.error || null,
      recipe: r.recipe,
    })),
    accuracy: accuracyOf(games),
    games,
    finals,
    db: await dbPayload(env),
  };
}

export async function collectBoards(env = {}, { odds = "cache" } = {}) {
  const date = todayCT();
  const sports = [];
  for (const sport of BOARD_SPORTS) {
    try {
      const slate = await buildSlate(sport, date, {
        ...env,
        parlayCacheOnly: odds !== "full",
      });
      await freezeSlate(slate, env);
      sports.push({
        sport,
        ok: true,
        n: slate.games?.length || 0,
        date: slate.date,
        pal: slate.pal?.games ?? slate.pal?.meta?.games ?? null,
      });
    } catch (err) {
      sports.push({ sport, ok: false, error: String(err?.message || err) });
    }
  }
  return {
    date,
    odds,
    sports,
    db: await dbPayload(env),
  };
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
  const since = year ? `${year}-03-01` : windowStart(days, sport === "all" ? "mlb" : sport);
  const until = year ? `${year}-11-15` : null;

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
  if (checkpoint && checkpoint !== "LATEST") rows = rows.filter((r) => r.checkpoint === checkpoint);

  const snapshotRows = rows;
  const displayRows = checkpoint === "LATEST" ? pickCanonical(rows) : rows;
  const acc = accuracyOf(displayRows);
  const pack = buildAccuracyPack(displayRows, { model, perGame });
  const byCheckpoint = {};
  for (const cp of CHECKPOINTS) {
    byCheckpoint[cp] = accuracyOf(snapshotRows.filter((r) => r.checkpoint === cp));
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
    pack,
    byCheckpoint,
    versions,
    games: displayRows.sort((a, b) => String(b.date).localeCompare(a.date) || String(a.matchup).localeCompare(b.matchup)).map(decorateRow),
    finals: displayRows.filter((r) => r.actualHome != null).map((r) => ({
      id: r.id,
      sport: r.sport,
      date: r.date,
      home: { name: r.homeName, abbr: r.homeAbbr, score: r.actualHome },
      away: { name: r.awayName, abbr: r.awayAbbr, score: r.actualAway },
      status: { completed: true },
    })),
    db: { ...db, ...counts, source, lastError: db.lastError || researchHealth().lastError },
  };
}
