/**
 * Baseball Savant + MLB Stats — run projections from SP quality and team offense.
 * Never a sportsbook. Never derived from the 1.5 run line.
 */

import { readCache, writeCache } from "./cache.js";

const TTL_MS = 30 * 60 * 1000;
const CACHE_VER = "savant-v1";
const LEAGUE_RPG = 4.45;
const LEAGUE_ERA = 4.15;
const LEAGUE_XWOBA = 0.32;
const HOME_EDGE = 1.04;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function num(v) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function parseCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/["']/g, ""));
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === "," && !q) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { Accept: "text/csv,application/json,*/*", "User-Agent": UA, Referer: "https://baseballsavant.mlb.com/" },
  });
  if (!res.ok) throw new Error(`Savant ${res.status}`);
  return res.text();
}

function pitcherFromRow(row) {
  const id = num(row.player_id || row.playerid || row.mlbam_id);
  const xwoba = num(row.est_woba || row.xwoba || row.xwoBA || row["est_woba"]);
  const era = num(row.era);
  const xera = num(row.xera || row.x_era);
  return {
    id,
    xwoba,
    era,
    xera,
    eraEq: xera || (xwoba != null ? LEAGUE_ERA * (xwoba / LEAGUE_XWOBA) : era),
  };
}

async function fetchSavantPitchers(year) {
  const url = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=pitcher&year=${year}&position=&team=&filterType=pa&min=1&csv=true`;
  const text = await getText(url);
  const rows = parseCsv(text);
  const byId = new Map();
  for (const row of rows) {
    const p = pitcherFromRow(row);
    if (p.id) byId.set(p.id, p);
  }
  return byId;
}

async function fetchTeamRpg(year) {
  const url = `https://statsapi.mlb.com/api/v1/teams/stats?season=${year}&group=hitting&stats=season&sportIds=1&gameType=R`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`MLB team stats ${res.status}`);
  const json = await res.json();
  const byId = new Map();
  const splits = json.stats?.[0]?.splits || [];
  let runSum = 0;
  let n = 0;
  for (const s of splits) {
    const id = Number(s.team?.id);
    const runs = num(s.stat?.runs);
    const g = num(s.stat?.gamesPlayed) || 1;
    if (!id || runs == null) continue;
    const rpg = runs / g;
    byId.set(id, { rpg, runs, games: g, name: s.team?.name, abbr: s.team?.abbreviation });
    runSum += rpg;
    n += 1;
  }
  return { byId, leagueRpg: n ? runSum / n : LEAGUE_RPG };
}

async function fetchPitcherEras(ids, year) {
  const unique = [...new Set(ids.filter(Boolean).map(Number))];
  const byId = new Map();
  const chunk = 8;
  for (let i = 0; i < unique.length; i += chunk) {
    await Promise.all(
      unique.slice(i, i + chunk).map(async (id) => {
        try {
          const url = `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=pitching&season=${year}&gameType=R`;
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          if (!res.ok) return;
          const json = await res.json();
          const stat = json.stats?.[0]?.splits?.[0]?.stat || {};
          byId.set(id, { era: num(stat.era), whip: num(stat.whip), innings: num(stat.inningsPitched) });
        } catch {
          /* skip */
        }
      })
    );
  }
  return byId;
}

export function projectMatchup({ homeRpg, awayRpg, homeSpEra, awaySpEra, leagueRpg = LEAGUE_RPG, park = 1 }) {
  const lg = leagueRpg || LEAGUE_RPG;
  const homeOff = (homeRpg || lg) / lg;
  const awayOff = (awayRpg || lg) / lg;
  const awayArm = (awaySpEra || LEAGUE_ERA) / LEAGUE_ERA;
  const homeArm = (homeSpEra || LEAGUE_ERA) / LEAGUE_ERA;
  const homeRuns = clamp(lg * homeOff * awayArm * park * HOME_EDGE, 2.3, 7.2);
  const awayRuns = clamp(lg * awayOff * homeArm * park, 2.3, 7.2);
  return {
    home: Math.round(homeRuns * 10) / 10,
    away: Math.round(awayRuns * 10) / 10,
  };
}

export async function fetchSavantSlate(games, cfCache) {
  const year = new Date().getFullYear();
  const cacheKey = `${CACHE_VER}:${year}`;
  let ctx = await readCache(cacheKey, cfCache, TTL_MS);
  if (!ctx) {
    try {
      const [pitchers, teams] = await Promise.all([
        fetchSavantPitchers(year).catch(() => new Map()),
        fetchTeamRpg(year),
      ]);
      ctx = {
        pitchers: [...pitchers.entries()],
        teams: [...teams.byId.entries()],
        leagueRpg: teams.leagueRpg,
      };
      await writeCache(cacheKey, ctx, cfCache, TTL_MS);
    } catch (err) {
      return { games, meta: { enabled: false, error: String(err.message || err) } };
    }
  }
  const pitchers = new Map(ctx.pitchers || []);
  const teams = new Map(ctx.teams || []);
  const leagueRpg = ctx.leagueRpg || LEAGUE_RPG;
  const spIds = games.flatMap((g) => [g.homeSp?.id, g.awaySp?.id]).filter(Boolean);
  const missing = spIds.filter((id) => !pitchers.get(Number(id))?.eraEq);
  let eraById = new Map();
  if (missing.length) {
    eraById = await fetchPitcherEras(missing, year).catch(() => new Map());
  }

  const next = games.map((g) => {
    if (g.sport && g.sport !== "mlb") return g;
    const homeRpg = teams.get(Number(g.home?.mlbId))?.rpg;
    const awayRpg = teams.get(Number(g.away?.mlbId))?.rpg;
    const homeSp = pitchers.get(Number(g.homeSp?.id));
    const awaySp = pitchers.get(Number(g.awaySp?.id));
    const homeEra = homeSp?.eraEq ?? eraById.get(Number(g.homeSp?.id))?.era;
    const awayEra = awaySp?.eraEq ?? eraById.get(Number(g.awaySp?.id))?.era;
    const weatherFactor = Number(g.mlbContext?.weatherRunFactor);
    const park = Number.isFinite(weatherFactor) && weatherFactor > 0 ? weatherFactor : 1;
    const proj = projectMatchup({
      homeRpg,
      awayRpg,
      homeSpEra: homeEra,
      awaySpEra: awayEra,
      leagueRpg,
      park,
    });
    return {
      ...g,
      savant: {
        homeRpg,
        awayRpg,
        homeSpEra: homeEra ?? null,
        awaySpEra: awayEra ?? null,
        weatherRunFactor: park,
        source: homeSp || awaySp ? "Savant" : "MLB",
      },
      projHomeScore: proj.home,
      projAwayScore: proj.away,
      // This score is produced only from the independent Savant/MLB Stats
      // run model above. Mark it explicitly so product/sheet layers do not
      // mistake it for a market-implied score.
      projectionKind: "FBIS",
    };
  });

  return {
    games: next,
    meta: { enabled: true, pitchers: pitchers.size, teams: teams.size, leagueRpg },
  };
}
