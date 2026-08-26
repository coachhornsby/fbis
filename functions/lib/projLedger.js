/**
 * Frozen projection ledger. Snapshot pregame scores, then grade vs finals.
 * Harvest uses scoreboards only — never Parlay — so nightly grading is free.
 */

import { readCache, writeCache } from "./cache.js";
import { namesMatch } from "./parlay.js";
import { BOARD_SPORTS, SPORTS, lastNDatesCT, todayCT, fetchResults } from "./slateEngine.js";

const TTL_MS = 21 * 24 * 60 * 60 * 1000;
const HARVEST_TTL_MS = 10 * 60 * 1000;
const CACHE_VER = "proj-v1";
const KEEP_DAYS = 21;

export const RECIPE_GUIDE = {
  mlb: {
    engine: "Baseball Savant (Pal overlay when keyed)",
    body: "Team runs/game × opposing starter ERA-equivalent, with a 1.04 home bump, clamped 2.3–7.2. Not derived from the ±1.5 run line. Pal simulated runs replace Savant when the Pal key is live.",
  },
  nba: {
    engine: "Pinnacle line-implied",
    body: "Home = total/2 − home spread/2. Away = total/2 + home spread/2. That is the market’s implied score until an independent NBA sim is wired. Win-prob still blends Pinnacle no-vig, ESPN win%, and W-L form.",
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

function freezeFromGame(date, game) {
  const model = game.model || {};
  const recipe = model.recipe || {};
  const projHome = model.projHome ?? game.projHomeScore;
  const projAway = model.projAway ?? game.projAwayScore;
  if (projHome == null || projAway == null) return null;
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
    projAway,
    projHome,
    projTotal: projAway + projHome,
    projMargin: projHome - projAway,
    engine: recipe.engine || "unknown",
    steps: recipe.steps || [],
    impliedHome: model.impliedHome ?? null,
    pHome: model.layers?.form ?? model.impliedHome ?? null,
    pinHomeMl: game.odds?.pinHomeMl ?? game.fairHomeMl ?? null,
    pinAwayMl: game.odds?.pinAwayMl ?? game.fairAwayMl ?? null,
    pinVig: game.pin?.ml?.vig ?? null,
    modelVersion: game.modelVersion || "FBIS-v1.0",
    frozenAt: new Date().toISOString(),
    actualAway: null,
    actualHome: null,
    actualTotal: null,
    gradedAt: null,
    f5Proj: game.bpp?.f5?.total ?? null,
    f5Away: game.bpp?.f5?.awayRuns ?? null,
    f5Home: game.bpp?.f5?.homeRuns ?? null,
    f5ActualAway: null,
    f5ActualHome: null,
  };
}

function applyFinal(row, final) {
  const hs = Number(final.home?.score);
  const as = Number(final.away?.score);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return row;
  if (!final.status?.completed) return row;
  const next = {
    ...row,
    actualHome: hs,
    actualAway: as,
    actualTotal: hs + as,
    gradedAt: row.gradedAt || new Date().toISOString(),
  };
  if (final.f5Score?.complete) {
    next.f5ActualHome = final.f5Score.home;
    next.f5ActualAway = final.f5Score.away;
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

export function accuracyOf(rows) {
  const graded = (rows || []).filter(
    (r) => r.projHome != null && r.actualHome != null && r.projAway != null && r.actualAway != null
  );
  const n = graded.length;
  if (!n) {
    return {
      n: 0,
      maeHome: null,
      maeAway: null,
      maeTotal: null,
      maeMargin: null,
      rmseTotal: null,
      biasTotal: null,
      winnerHit: null,
      brierModel: null,
      brierMarket: null,
    };
  }
  const abs = (a, b) => Math.abs(a - b);
  const winnerHits = graded.filter((r) => {
    const projHomeWin = r.projHome === r.projAway ? null : r.projHome > r.projAway;
    const actualHomeWin = r.actualHome === r.actualAway ? null : r.actualHome > r.actualAway;
    if (projHomeWin == null || actualHomeWin == null) return false;
    return projHomeWin === actualHomeWin;
  }).length;
  const decided = graded.filter((r) => r.actualHome !== r.actualAway && r.projHome !== r.projAway).length;
  const brier = (key) => {
    const xs = graded.filter((r) => r[key] != null && r.actualHome !== r.actualAway);
    if (!xs.length) return null;
    return mean(xs.map((r) => {
      const y = r.actualHome > r.actualAway ? 1 : 0;
      return (r[key] - y) ** 2;
    }));
  };
  return {
    n,
    maeHome: mean(graded.map((r) => abs(r.projHome, r.actualHome))),
    maeAway: mean(graded.map((r) => abs(r.projAway, r.actualAway))),
    maeTotal: mean(graded.map((r) => abs(r.projTotal, r.actualTotal))),
    maeMargin: mean(graded.map((r) => abs(r.projMargin, r.actualHome - r.actualAway))),
    rmseTotal: Math.sqrt(mean(graded.map((r) => (r.projTotal - r.actualTotal) ** 2))),
    biasTotal: mean(graded.map((r) => r.projTotal - r.actualTotal)),
    winnerHit: decided ? winnerHits / decided : null,
    brierModel: brier("pHome"),
    brierMarket: brier("impliedHome"),
  };
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

export async function freezeSlate(slate, cfCache) {
  if (!slate?.sport || !slate.games) return;
  const ledger = await loadLedger(slate.sport, cfCache);
  let changed = false;
  for (const game of slate.games) {
    const k = rowKey(slate.date, game.id);
    const existing = ledger.games[k];
    if (!existing && !game.status?.live && !game.status?.completed) {
      const frozen = freezeFromGame(slate.date, game);
      if (frozen) {
        ledger.games[k] = frozen;
        changed = true;
      }
    }
    if (existing && game.status?.completed && existing.actualHome == null) {
      ledger.games[k] = applyFinal(existing, game);
      changed = true;
    }
  }
  if (changed) await saveLedger(slate.sport, ledger, cfCache);
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
    return cached;
  }

  for (const date of dates) {
    try {
      const results = await fetchResults(sport, date);
      for (const g of results) finals.push({ ...g, date });
      for (const g of results) {
        const k = rowKey(date, g.id);
        const existing =
          ledger.games[k] ||
          Object.values(ledger.games).find(
            (row) => row.date === date && matchFinal(row, [g])
          );
        if (existing && g.status?.completed && existing.actualHome == null) {
          const next = applyFinal(existing, g);
          ledger.games[existing.date + ":" + existing.id] = next;
        }
      }
    } catch {
      /* one date failing should not kill the harvest */
    }
  }

  const saved = await saveLedger(sport, ledger, cfCache);
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
  };
  await writeCache(harvestKey, report, cfCache, HARVEST_TTL_MS);
  return report;
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
  };
}

export async function buildTrackReport(sport, days, env = {}) {
  if (!sport || sport === "all") return harvestAll(days, env);
  const one = await harvestSport(sport, days, env);
  return { ...one, recipeGuide: RECIPE_GUIDE, sports: [{ sport: one.sport, sportName: one.sportName, accuracy: one.accuracy, recipe: one.recipe }] };
}
