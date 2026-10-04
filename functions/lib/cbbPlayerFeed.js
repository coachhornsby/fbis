/**
 * CBBD-backed CBB player context.
 *
 * Two cached, line-independent inputs:
 * - /stats/player/season: season-to-date player production/usage/minutes
 * - /games/players: recent player box scores for form + role stability
 *
 * PrizePicks/sportsbook lines never enter this module.
 */
import { cbbdGet, cbbSeasonYear } from "./collegeApi.js";
import { readCache, writeCache } from "./cache.js";

const SEASON_TTL = 3 * 60 * 60 * 1000;
const RECENT_TTL = 45 * 60 * 1000;

function norm(v) {
  return String(v || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function n(v) {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function mean(xs = []) {
  const a = xs.map(n).filter((x) => x != null);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}
function std(xs = []) {
  const a = xs.map(n).filter((x) => x != null);
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function dateWindow(asOf, days = 28) {
  const end = new Date(asOf || Date.now());
  if (!Number.isFinite(end.getTime())) end.setTime(Date.now());
  const start = new Date(end.getTime() - days * 86400000);
  return { start: start.toISOString(), end: end.toISOString() };
}
function teamKeys(team = {}) {
  return [...new Set([
    team?.school, team?.name, team?.fullName, team?.displayName, team?.abbr,
  ].map(norm).filter(Boolean))];
}
function seasonPlayer(row = {}) {
  const games = n(row.games) || 0;
  const minutes = n(row.minutes) || 0;
  const gpDen = Math.max(games, 1);
  const minDen = Math.max(minutes, 1);
  return {
    id: row.athleteId ?? row.athleteSourceId ?? null,
    sourceId: row.athleteSourceId ?? null,
    name: row.name || null,
    team: row.team || null,
    position: row.position || null,
    games,
    starts: n(row.starts) || 0,
    minutes,
    minutesPerGame: minutes / gpDen,
    pointsPerGame: (n(row.points) || 0) / gpDen,
    reboundsPerGame: (n(row.rebounds?.total) || 0) / gpDen,
    assistsPerGame: (n(row.assists) || 0) / gpDen,
    threesMadePerGame: (n(row.threePointFieldGoals?.made) || 0) / gpDen,
    fieldGoalAttemptsPerGame: (n(row.fieldGoals?.attempted) || 0) / gpDen,
    freeThrowAttemptsPerGame: (n(row.freeThrows?.attempted) || 0) / gpDen,
    offensiveReboundsPerGame: (n(row.rebounds?.offensive) || 0) / gpDen,
    defensiveReboundsPerGame: (n(row.rebounds?.defensive) || 0) / gpDen,
    turnoversPerGame: (n(row.turnovers) || 0) / gpDen,
    stealsPerGame: (n(row.steals) || 0) / gpDen,
    blocksPerGame: (n(row.blocks) || 0) / gpDen,
    pointsPer40: (n(row.points) || 0) * 40 / minDen,
    reboundsPer40: (n(row.rebounds?.total) || 0) * 40 / minDen,
    assistsPer40: (n(row.assists) || 0) * 40 / minDen,
    threesMadePer40: (n(row.threePointFieldGoals?.made) || 0) * 40 / minDen,
    fieldGoalAttemptsPer40: (n(row.fieldGoals?.attempted) || 0) * 40 / minDen,
    freeThrowAttemptsPer40: (n(row.freeThrows?.attempted) || 0) * 40 / minDen,
    offensiveReboundsPer40: (n(row.rebounds?.offensive) || 0) * 40 / minDen,
    defensiveReboundsPer40: (n(row.rebounds?.defensive) || 0) * 40 / minDen,
    turnoversPer40: (n(row.turnovers) || 0) * 40 / minDen,
    usage: n(row.usage),
    offensiveRating: n(row.offensiveRating),
    trueShootingPct: n(row.trueShootingPct),
    effectiveFieldGoalPct: n(row.effectiveFieldGoalPct),
  };
}
function recentRows(gameRows = []) {
  const byPlayer = new Map();
  for (const game of gameRows || []) {
    const team = game?.team || null;
    const gameId = game?.gameId ?? null;
    const startDate = game?.startDate || null;
    const pace = n(game?.gamePace);
    for (const p of game?.players || []) {
      const key = String(p?.athleteId ?? p?.athleteSourceId ?? "");
      if (!key) continue;
      if (!byPlayer.has(key)) byPlayer.set(key, []);
      byPlayer.get(key).push({
        gameId,
        startDate,
        team,
        pace,
        minutes: n(p.minutes),
        points: n(p.points),
        rebounds: n(p.rebounds?.total),
        assists: n(p.assists),
        threesMade: n(p.threePointFieldGoals?.made),
        fieldGoalAttempts: n(p.fieldGoals?.attempted),
        freeThrowAttempts: n(p.freeThrows?.attempted),
        offensiveRebounds: n(p.rebounds?.offensive),
        defensiveRebounds: n(p.rebounds?.defensive),
        turnovers: n(p.turnovers),
        steals: n(p.steals),
        blocks: n(p.blocks),
        usage: n(p.usage),
        starter: p.starter === true,
        didNotPlay: p.didNotPlay === true || p.did_not_play === true,
      });
    }
  }
  for (const rows of byPlayer.values()) {
    rows.sort((a, b) => String(b.startDate || "").localeCompare(String(a.startDate || "")));
  }
  return byPlayer;
}

export async function loadCbbPlayerContext(env = {}, asOf = new Date()) {
  const season = cbbSeasonYear(asOf);
  const cachesObj = env.caches;
  const seasonKey = "cbb-player-season-v1-" + season;
  const recentKey = "cbb-player-recent-v1-" + season;
  let seasonData = await readCache(seasonKey, cachesObj, SEASON_TTL);
  let recentData = await readCache(recentKey, cachesObj, RECENT_TTL);

  if (!seasonData) {
    const res = await cbbdGet("/stats/player/season", env, {
      query: { season, seasonType: "regular" },
    });
    seasonData = {
      ok: Boolean(res.ok),
      rows: Array.isArray(res.data) ? res.data : [],
      error: res.ok ? null : res.reason || "season-player-stats-unavailable",
      fetchedAt: new Date().toISOString(),
    };
    await writeCache(seasonKey, seasonData, cachesObj, res.ok ? SEASON_TTL : 10 * 60 * 1000);
  }

  if (!recentData) {
    const w = dateWindow(asOf, 28);
    const res = await cbbdGet("/games/players", env, {
      query: { startDateRange: w.start, endDateRange: w.end, seasonType: "regular" },
    });
    recentData = {
      ok: Boolean(res.ok),
      rows: Array.isArray(res.data) ? res.data : [],
      error: res.ok ? null : res.reason || "recent-player-games-unavailable",
      fetchedAt: new Date().toISOString(),
      window: w,
    };
    await writeCache(recentKey, recentData, cachesObj, res.ok ? RECENT_TTL : 10 * 60 * 1000);
  }

  const recent = recentRows(recentData.rows);
  const byTeam = {};
  for (const raw of seasonData.rows || []) {
    const p = seasonPlayer(raw);
    const keys = [norm(raw.team)].filter(Boolean);
    const logs = recent.get(String(raw.athleteId ?? raw.athleteSourceId ?? "")) || [];
    const last5 = logs.slice(0, 5);
    const last3 = logs.slice(0, 3);
    const startsRecent = last5.filter((x) => x.starter).length;
    const minRecent = mean(last5.map((x) => x.minutes));
    const projectedMinutes = Math.max(0, Math.min(40,
      minRecent == null ? p.minutesPerGame : 0.58 * minRecent + 0.42 * p.minutesPerGame
    ));
    const roleConfidence = Math.max(0, Math.min(1,
      0.35 * Math.min(p.games / 8, 1) +
      0.30 * Math.min(projectedMinutes / 30, 1) +
      0.20 * Math.min(startsRecent / 3, 1) +
      0.15 * Math.min(last5.length / 5, 1)
    ));
    const enriched = {
      ...p,
      projectedMinutes,
      roleConfidence,
      sampleSize: p.games,
      recentGames: last5.length,
      recent: {
        minutes: mean(last5.map((x) => x.minutes)),
        points: mean(last5.map((x) => x.points)),
        rebounds: mean(last5.map((x) => x.rebounds)),
        assists: mean(last5.map((x) => x.assists)),
        threesMade: mean(last5.map((x) => x.threesMade)),
        usage: mean(last5.map((x) => x.usage)),
        pace: mean(last5.map((x) => x.pace)),
      },
      volatility: {
        minutes: std(last5.map((x) => x.minutes)),
        points: std(last5.map((x) => x.points)),
        rebounds: std(last5.map((x) => x.rebounds)),
        assists: std(last5.map((x) => x.assists)),
        threesMade: std(last5.map((x) => x.threesMade)),
      },
      role: {
        startsRecent,
        lastGameMinutes: last5[0]?.minutes ?? null,
        lastGameDnp: Boolean(last5[0]?.didNotPlay),
        minuteStability: (() => {
          const sd = std(last5.map((x) => x.minutes));
          return sd == null ? null : Math.max(0, Math.min(1, 1 - sd / 18));
        })(),
      },
      trend: {
        points: mean(last3.map((x) => x.points)),
        rebounds: mean(last3.map((x) => x.rebounds)),
        assists: mean(last3.map((x) => x.assists)),
        threesMade: mean(last3.map((x) => x.threesMade)),
      },
    };
    for (const k of keys) {
      if (!byTeam[k]) byTeam[k] = [];
      byTeam[k].push(enriched);
    }
  }

  for (const list of Object.values(byTeam)) {
    list.sort((a, b) => (b.projectedMinutes || 0) - (a.projectedMinutes || 0));
  }

  return {
    ok: Boolean(seasonData.ok),
    season,
    byTeam,
    meta: {
      source: "CBBD /stats/player/season + /games/players",
      marketInformed: false,
      seasonRows: (seasonData.rows || []).length,
      recentGameTeamRows: (recentData.rows || []).length,
      seasonFetchedAt: seasonData.fetchedAt || null,
      recentFetchedAt: recentData.fetchedAt || null,
      recentWindow: recentData.window || null,
      seasonError: seasonData.error || null,
      recentError: recentData.error || null,
    },
  };
}

export function playersForCbbGame(game = {}, context = {}) {
  const out = {};
  for (const side of ["home", "away"]) {
    const team = game?.[side] || {};
    let rows = [];
    for (const k of teamKeys(team)) {
      if (context?.byTeam?.[k]?.length) { rows = context.byTeam[k]; break; }
    }
    out[side] = rows;
  }
  return out;
}
