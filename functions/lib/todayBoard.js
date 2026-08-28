/**
 * TODAY board: every scheduled game on the operator CT date, all supported sports.
 * Ordinary loads are cache-only for Parlay (and Pal). ESPN/MLB Stats remain free.
 */

import { BOARD_SPORTS, SPORTS, todayCT, shiftDateCT, buildSlate, recommendBundle } from "./slateEngine.js";
import { classifyBoardStatus, kickoffCt, noPlayReason, isPreStartStatus, isLiveStatus } from "./gameStatus.js";
import { DEFAULT_WEIGHTS } from "./weights.js";
import { palUnavailableReason } from "./ballparkpal.js";
import { buildPropConvictions } from "./propConviction.js";

function withRecs(slate, weights = DEFAULT_WEIGHTS) {
  return {
    ...slate,
    games: (slate?.games || []).map((game) => {
      const bundle = recommendBundle(slate.sport, game, game.model, weights);
      return { ...game, rec: bundle.qualified, lean: bundle.lean };
    }),
  };
}

export { todayCT, shiftDateCT };

export function resolveTodayDate(raw, now = new Date()) {
  const today = todayCTFrom(now);
  const value = String(raw || "").trim();
  if (!value) return { date: today, ok: true, today };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { date: today, ok: false, error: "date must be YYYY-MM-DD", today };
  }
  return { date: value, ok: true, today };
}

export function todayCTFrom(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now instanceof Date ? now : new Date(now));
}

export function utcMidnightVsCt(utcIso) {
  const utcDate = String(utcIso).slice(0, 10);
  const ctDate = todayCTFrom(new Date(utcIso));
  return { utcDate, ctDate, differs: utcDate !== ctDate };
}

export function toBoardGame(game, sport, now = Date.now()) {
  const status = classifyBoardStatus(game, now);
  const pinSpread =
    game.odds?.pinSpread ??
    (game.odds?.pinSpreadHomePrice != null ? game.odds.spread : null);
  const pinTotal =
    game.odds?.pinTotal ?? (game.odds?.pinOverPrice != null ? game.odds.total : null);
  const rec = game.rec || null;
  const lean = game.lean || null;
  const sportsbookProps = [...(game.odds?.playerProps || [])]
    .filter((p) => p?.overPrice != null && p?.underPrice != null && p?.line != null);
  const palProps = [...(game.bpp?.props || [])]
    .filter((p) => p?.over != null || p?.under != null)
    .sort((a, b) => Math.abs(Number(b.over ?? 0.5) - 0.5) - Math.abs(Number(a.over ?? 0.5) - 0.5));
  const propConvictions = sport === "mlb" ? buildPropConvictions({
    palProps, sportsbookProps, lineupsOfficial: Boolean(game.bpp?.lineupsOfficial),
    confirmedPitcherIds: [game.bpp?.homeSp?.id, game.bpp?.awaySp?.id], now,
  }) : [];
  return {
    id: String(game.id),
    sport,
    sportLabel: SPORTS[sport]?.label || sport.toUpperCase(),
    start: game.start || null,
    startCt: kickoffCt(game.start),
    status,
    statusDetail: game.status?.detail || status,
    away: {
      name: game.away?.name,
      school: game.away?.school,
      fullName: game.away?.fullName,
      abbr: game.away?.abbr,
      logo: game.away?.logo,
      canonicalId: game.away?.canonicalId,
      score: game.away?.score ?? null,
    },
    home: {
      name: game.home?.name,
      school: game.home?.school,
      fullName: game.home?.fullName,
      abbr: game.home?.abbr,
      logo: game.home?.logo,
      canonicalId: game.home?.canonicalId,
      score: game.home?.score ?? null,
    },
    venue: game.venue || "",
    neutral: Boolean(game.neutralSite),
    score:
      game.home?.score != null && game.away?.score != null
        ? { away: game.away.score, home: game.home.score }
        : null,
    projHome: game.model?.projHome ?? game.projHomeScore ?? null,
    projAway: game.model?.projAway ?? game.projAwayScore ?? null,
    projTotal: game.model?.projTotal ?? null,
    projMargin: game.model?.projMargin ?? null,
    marketProjHome: game.model?.marketProjHome ?? game.marketProjHome ?? null,
    marketProjAway: game.model?.marketProjAway ?? game.marketProjAway ?? null,
    projectionKind: game.model?.projectionKind || game.projectionKind || null,
    projectionState: game.cfb?.projectionState || game.projectionState || null,
    projectionRecipe: game.model?.recipe || null,
    cfbDetail: game.cfb ? {
      hfa: game.cfb.hfa, sigmaMargin: game.cfb.sigmaMargin, sigmaTotal: game.cfb.sigmaTotal,
      maturity: game.cfb.maturity, dataQuality: game.cfb.dataQuality, flags: game.cfb.flags || [], priorVersion: game.cfb.priorVersion,
      home: game.cfb.homeEst ? { rank: game.cfb.homeEst.rank, priorOff: game.cfb.homeEst.priorOff, priorDef: game.cfb.homeEst.priorDef, games: game.cfb.homeEst.n, currentOff: game.cfb.homeEst.currentOff, currentDef: game.cfb.homeEst.currentDef } : null,
      away: game.cfb.awayEst ? { rank: game.cfb.awayEst.rank, priorOff: game.cfb.awayEst.priorOff, priorDef: game.cfb.awayEst.priorDef, games: game.cfb.awayEst.n, currentOff: game.cfb.awayEst.currentOff, currentDef: game.cfb.awayEst.currentDef } : null,
    } : null,
    bettingAllowed: game.cfb ? game.cfb.bettingAllowed : game.sport === "nfl" ? false : null,
    blockReason: game.cfb?.blockReason || null,
    marketLabels: game.marketLabels || null,
    pHome: game.model?.pHomeFinal ?? null,
    pinMlHome: game.odds?.pinHomeMl ?? null,
    pinMlAway: game.odds?.pinAwayMl ?? null,
    pinSpread,
    pinSpreadHomePrice: game.odds?.pinSpreadHomePrice ?? null,
    pinSpreadAwayPrice: game.odds?.pinSpreadAwayPrice ?? null,
    pinTotal,
    pinOverPrice: game.odds?.pinOverPrice ?? null,
    pinUnderPrice: game.odds?.pinUnderPrice ?? null,
    quality: game.quality || null,
    modelVersion: game.modelVersion || null,
    checkpoint: game.checkpoint || null,
    rec: rec
      ? {
          pick: rec.pick,
          market: rec.market,
          tag: rec.tag,
          ev: rec.ev,
          qualified: true,
        }
      : null,
    lean: !rec && lean
      ? {
          pick: lean.pick,
          market: lean.market,
          reason: lean.reason || noPlayReason({ ...game, lean, rec: null }),
        }
      : null,
    noPlayReason: rec ? null : noPlayReason(game),
    marketUnavailable: !(game.odds?.pinHomeMl != null && game.odds?.pinAwayMl != null) && pinTotal == null && pinSpread == null,
    projectionUnavailable: (game.model?.projHome == null && game.model?.projAway == null) || game.projectionKind === "UNAVAILABLE",
    qualificationBlocked: Boolean(game.qualificationBlocked || (game.cfb && !game.cfb.bettingAllowed) || (game.sport === "nfl" && game.projectionKind !== "FBIS")),
    challengers: game.challengers || null,
    championModel: game.championModel || null,
    palMatched: Boolean(game.bpp),
    palHome: game.bpp?.homeRuns ?? game.model?.palHome ?? null,
    palAway: game.bpp?.awayRuns ?? game.model?.palAway ?? null,
    palPHome: game.bpp?.pHome ?? game.model?.layers?.pal ?? null,
    palF5Home: game.bpp?.f5?.homeRuns ?? null,
    palF5Away: game.bpp?.f5?.awayRuns ?? null,
    palF5HomeWin: game.bpp?.f5?.homeWin ?? null,
    palF5AwayWin: game.bpp?.f5?.awayWin ?? null,
    f5Book: game.odds?.f5 || null,
    sportsbookProps: [],
    sportsbookPropCount: sportsbookProps.length,
    propConvictions,
    lineupsOfficial: Boolean(game.bpp?.lineupsOfficial),
    sentiment: game.sentiment || game.odds?.sentiment || null,
    weather: game.weather || game.cfb?.weather || null,
    park: game.bpp?.park || null,
    palPark: game.bpp?.park || null,
    palTeamTotals: game.bpp?.teamTotals || [],
    palProps: [],
    palPropCount: palProps.length,
    palAsOf: game.bpp?.asOf ?? null,
    palRequestId: game.bpp?.requestId ?? null,
    palUnavailableReason: game.palUnavailableReason
      ? game.palUnavailableReason
      : game.bpp
        ? game.bpp.homeRuns == null || game.bpp.awayRuns == null
          ? "projection-fields-missing"
          : null
        : palUnavailableReason({ reason: "team-mismatch" }, game),
    live: status === "live" || status === "halftime",
    final: status === "final",
  };
}

export function sortByStart(games) {
  return [...(games || [])].sort((a, b) => {
    const as = Date.parse(a.start || "") || 0;
    const bs = Date.parse(b.start || "") || 0;
    if (as !== bs) return as - bs;
    return String(a.away?.abbr || "").localeCompare(String(b.away?.abbr || ""));
  });
}

export function groupBySport(games) {
  const groups = [];
  const by = new Map();
  for (const id of BOARD_SPORTS) by.set(id, []);
  for (const g of games || []) {
    if (!by.has(g.sport)) by.set(g.sport, []);
    by.get(g.sport).push(g);
  }
  for (const id of BOARD_SPORTS) {
    const list = sortByStart(by.get(id) || []);
    groups.push({
      sport: id,
      label: SPORTS[id]?.label || id.toUpperCase(),
      n: list.length,
      games: list,
    });
  }
  return groups;
}

export function filterTodayGames(games, { sport = "all", bucket = "all" } = {}) {
  let xs = games || [];
  if (sport && sport !== "all") xs = xs.filter((g) => g.sport === sport);
  if (bucket === "scheduled" || bucket === "pregame") xs = xs.filter((g) => isPreStartStatus(g.status));
  else if (bucket === "live") xs = xs.filter((g) => isLiveStatus(g.status));
  else if (bucket === "final") xs = xs.filter((g) => g.status === "final");
  else if (bucket === "qualified") xs = xs.filter((g) => g.rec);
  else if (bucket === "leans") xs = xs.filter((g) => g.lean && !g.rec);
  return xs;
}

export function emptyTodayState({ date, feeds = {} } = {}) {
  const failed = Object.entries(feeds).filter(([, f]) => f?.error);
  if (failed.length && Object.values(feeds).every((f) => f?.error || !f?.games)) {
    return { kind: "feed-failure", message: "Scoreboard feed failed for every sport." };
  }
  return { kind: "no-games", message: `No games scheduled for ${date} CT.` };
}

export async function buildTodayBoard(date, env = {}, { buildSlateFn, now = Date.now() } = {}) {
  const builder = buildSlateFn || buildSlate;
  const sports = [];
  const games = [];
  const feeds = {};
  let parlayNetwork = 0;
  for (const sport of BOARD_SPORTS) {
    try {
      const slate = await builder(sport, date, {
        ...env,
        parlayCacheOnly: true,
        palCacheOnly: true,
      });
      if (slate?.parlay?.cached === false && slate?.parlay?.skipped !== true && !slate?.parlay?.error) {
        parlayNetwork += 1;
      }
      const recSlate = withRecs(slate, DEFAULT_WEIGHTS);
      const palReason = sport === "mlb" ? palUnavailableReason(slate.pal?.meta || slate.pal || {}, null) : null;
      const rows = (recSlate.games || []).map((g) =>
        toBoardGame({ ...g, sport, palUnavailableReason: g.bpp ? g.palUnavailableReason : palReason }, sport, now)
      );
      feeds[sport] = {
        ok: true,
        n: rows.length,
        error: null,
        pal: slate.pal || null,
        palReason: sport === "mlb" ? palUnavailableReason(slate.pal?.meta || slate.pal || {}, null) : null,
        parlay: slate.parlay || null,
        cachedParlay: Boolean(slate.parlay?.cached || slate.parlay?.skipped),
      };
      sports.push({
        sport,
        label: SPORTS[sport].label,
        n: rows.length,
        games: sortByStart(rows),
      });
      games.push(...rows);
    } catch (err) {
      feeds[sport] = { ok: false, n: 0, error: String(err?.message || err) };
      sports.push({
        sport,
        label: SPORTS[sport].label,
        n: 0,
        games: [],
        error: String(err?.message || err),
      });
    }
  }
  const all = sortByStart(games);
  const empty = all.length ? null : emptyTodayState({ date, feeds });
  return {
    date,
    timezone: "America/Chicago",
    generatedAt: new Date().toISOString(),
    sports,
    games: all,
    groups: groupBySport(all),
    counts: {
      games: all.length,
      bySport: Object.fromEntries(sports.map((s) => [s.sport, s.n])),
      scheduled: all.filter((g) => isPreStartStatus(g.status)).length,
      live: all.filter((g) => isLiveStatus(g.status)).length,
      final: all.filter((g) => g.status === "final").length,
      qualified: all.filter((g) => g.rec).length,
      leans: all.filter((g) => g.lean && !g.rec).length,
      postponed: all.filter((g) => g.status === "postponed").length,
      cfbDiagnostics: (all.filter((g) => g.sport === "cfb").length
        ? {
            states: Object.fromEntries(
              ["COMPLETE", "PARTIAL", "PRIOR_ONLY", "LEAGUE_AVERAGE_ONLY", "UNAVAILABLE"].map((s) => [
                s,
                all.filter((g) => g.sport === "cfb" && g.projectionState === s).length,
              ])
            ),
          }
        : null),
    },
    feeds,
    empty,
    parlay: {
      cacheOnly: true,
      extraFullOddsRequests: parlayNetwork,
    },
  };
}
