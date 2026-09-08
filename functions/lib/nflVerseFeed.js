/**
 * nflverse feature feed for NFL-PRO-v1.
 *
 * Free public data only. The feed is cached and used only to enrich the shadow
 * challenger. It never touches Pinnacle, sportsbook prices, or qualification.
 * Current-season team/QB evidence is shrunk toward the prior season with an
 * explicit eight-game prior weight. At Week 0 it is therefore a prior, not fake
 * current-season precision.
 */

import { readCache, writeCache } from "./cache.js";

const TTL_MS = 3 * 60 * 60 * 1000;
const ERR_TTL_MS = 20 * 60 * 1000;
const PRIOR_GAMES = 8;
const RELEASE = "https://github.com/nflverse/nflverse-data/releases/download";

const ABBR = {
  JAC: "JAX", JAX: "JAX",
  LA: "LAR", LAR: "LAR",
  LV: "LV", OAK: "LV",
  WAS: "WAS", WSH: "WAS",
  SD: "LAC", LAC: "LAC",
  STL: "LAR",
};

function canon(v) {
  const s = String(v || "").trim().toUpperCase();
  return ABBR[s] || s;
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function seasonYear(date = new Date()) {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).format(date);
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 8 ? y : y - 1;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text = "") {
  const lines = String(text).replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
}

async function fetchCsv(url, fetchFn = fetch) {
  const res = await fetchFn(url, { headers: { Accept: "text/csv,*/*", "User-Agent": "FBIS/1.0" } });
  if (!res.ok) return { ok: false, status: res.status, rows: [], url };
  return { ok: true, status: res.status, rows: parseCsv(await res.text()), url };
}

function teamUrl(year) { return `${RELEASE}/stats_team/stats_team_week_${year}.csv`; }
function playerUrl(year) { return `${RELEASE}/stats_player/stats_player_week_${year}.csv`; }

function addAgg(map, key, values = {}) {
  if (!key) return;
  const out = map[key] || (map[key] = { games: new Set(), passEpa: 0, passPlays: 0, rushEpa: 0, rushPlays: 0, qbHits: 0, sacks: 0, oppDropbacks: 0 });
  if (values.gameKey) out.games.add(values.gameKey);
  out.passEpa += values.passEpa || 0;
  out.passPlays += values.passPlays || 0;
  out.rushEpa += values.rushEpa || 0;
  out.rushPlays += values.rushPlays || 0;
  out.qbHits += values.qbHits || 0;
  out.sacks += values.sacks || 0;
  out.oppDropbacks += values.oppDropbacks || 0;
}

export function aggregateTeamWeeks(rows = []) {
  const offense = {};
  const defense = {};
  const byGame = new Map();
  for (const row of rows) {
    if (String(row.season_type || "REG").toUpperCase() !== "REG") continue;
    const team = canon(row.team);
    const opp = canon(row.opponent_team);
    const week = num(row.week);
    if (!team || !opp || week == null) continue;
    const attempts = num(row.attempts) || 0;
    const sacks = num(row.sacks_suffered) || 0;
    const carries = num(row.carries) || 0;
    const vals = {
      gameKey: `${week}:${team}:${opp}`,
      passEpa: num(row.passing_epa) || 0,
      passPlays: attempts + sacks,
      rushEpa: num(row.rushing_epa) || 0,
      rushPlays: carries,
      qbHits: num(row.def_qb_hits) || 0,
      sacks: num(row.def_sacks) || 0,
    };
    addAgg(offense, team, vals);
    byGame.set(`${week}:${team}`, { team, opp, ...vals });
  }
  // A team's defensive EPA allowed is exactly the offense accumulated by its
  // opponents in the games played against it. We invert the weekly team rows,
  // preserving actual game-level opponent identity rather than using schedule-strength guesses.
  for (const g of byGame.values()) {
    const opponentOffense = g;
    const ownOppRow = byGame.get(`${String(g.gameKey).split(":")[0]}:${g.opp}`);
    addAgg(defense, g.opp, {
      gameKey: g.gameKey,
      passEpa: opponentOffense.passEpa,
      passPlays: opponentOffense.passPlays,
      rushEpa: opponentOffense.rushEpa,
      rushPlays: opponentOffense.rushPlays,
      qbHits: ownOppRow?.qbHits || 0,
      sacks: ownOppRow?.sacks || 0,
      oppDropbacks: opponentOffense.passPlays,
    });
  }
  const finish = (src, defensive = false) => Object.fromEntries(Object.entries(src).map(([team, a]) => {
    const pass = a.passPlays ? a.passEpa / a.passPlays : null;
    const rush = a.rushPlays ? a.rushEpa / a.rushPlays : null;
    const plays = a.passPlays + a.rushPlays;
    const total = plays ? (a.passEpa + a.rushEpa) / plays : null;
    return [team, {
      games: a.games.size,
      ...(defensive ? { defenseEpa: total, passEpaAllowed: pass, rushEpaAllowed: rush } : { offenseEpa: total, passEpa: pass, rushEpa: rush }),
      ...(defensive ? { pressureRate: a.oppDropbacks ? a.qbHits / a.oppDropbacks : null } : { pressureRateAllowed: null }),
    }];
  }));
  return { offense: finish(offense), defense: finish(defense, true) };
}

export function aggregateQbWeeks(rows = []) {
  const byTeam = {};
  for (const row of rows) {
    if (String(row.season_type || "REG").toUpperCase() !== "REG") continue;
    const team = canon(row.team);
    if (!team) continue;
    const attempts = num(row.attempts) || 0;
    const sacks = num(row.sacks_suffered) || 0;
    if (attempts < 5) continue;
    const dropbacks = attempts + sacks;
    const q = byTeam[team] || (byTeam[team] = { epa: 0, dropbacks: 0, cpoeNumerator: 0, cpoeWeight: 0, sacks: 0, attempts: 0, games: new Set() });
    q.epa += num(row.passing_epa) || 0;
    q.dropbacks += dropbacks;
    const cpoe = num(row.passing_cpoe);
    if (cpoe != null) { q.cpoeNumerator += cpoe * attempts; q.cpoeWeight += attempts; }
    q.sacks += sacks;
    q.attempts += attempts;
    q.games.add(`${row.week}:${team}`);
  }
  return Object.fromEntries(Object.entries(byTeam).map(([team, q]) => [team, {
    games: q.games.size,
    qbEpa: q.dropbacks ? q.epa / q.dropbacks : null,
    qbCpoe: q.cpoeWeight ? q.cpoeNumerator / q.cpoeWeight : null,
    qbSackRate: q.dropbacks ? q.sacks / q.dropbacks : null,
  }]));
}

function blend(prior, current, n, priorGames = PRIOR_GAMES) {
  const p = num(prior);
  const c = num(current);
  if (p == null) return c;
  if (c == null) return p;
  const w = Math.max(0, Number(n) || 0) / (Math.max(0, Number(n) || 0) + priorGames);
  return p * (1 - w) + c * w;
}

function combineTeam(prior = {}, current = {}) {
  const n = current.games || 0;
  const fields = ["offenseEpa", "defenseEpa", "passEpa", "passEpaAllowed", "rushEpa", "rushEpaAllowed", "pressureRate"];
  const out = { games: n, priorGames: PRIOR_GAMES, source: "nflverse-weekly-team" };
  for (const f of fields) out[f] = blend(prior[f], current[f], n);
  return out;
}

function combineQb(prior = {}, current = {}) {
  const n = current.games || 0;
  return {
    games: n,
    qbEpa: blend(prior.qbEpa, current.qbEpa, n),
    qbCpoe: blend(prior.qbCpoe, current.qbCpoe, n),
    qbSackRate: blend(prior.qbSackRate, current.qbSackRate, n),
    qbPrior: prior.qbEpa,
    source: "nflverse-weekly-player",
  };
}

async function seasonBundle(year, fetchFn) {
  const [team, player] = await Promise.all([fetchCsv(teamUrl(year), fetchFn), fetchCsv(playerUrl(year), fetchFn)]);
  const teamAgg = aggregateTeamWeeks(team.rows);
  return {
    year,
    teamStatus: team.status,
    playerStatus: player.status,
    offense: teamAgg.offense,
    defense: teamAgg.defense,
    qb: aggregateQbWeeks(player.rows),
    rows: { team: team.rows.length, player: player.rows.length },
  };
}

export async function loadNflVerseFeatures(env = {}, { fetchFn = fetch, now = Date.now() } = {}) {
  const season = seasonYear(new Date(now));
  const cacheKey = `nflverse-features-v1-${season}`;
  const cached = await readCache(cacheKey, env.caches, TTL_MS);
  if (cached?.meta) return cached;
  try {
    const [current, prior] = await Promise.all([seasonBundle(season, fetchFn), seasonBundle(season - 1, fetchFn)]);
    const teams = new Set([
      ...Object.keys(prior.offense), ...Object.keys(prior.defense), ...Object.keys(prior.qb),
      ...Object.keys(current.offense), ...Object.keys(current.defense), ...Object.keys(current.qb),
    ]);
    const byTeam = {};
    for (const team of teams) {
      byTeam[team] = {
        ...combineTeam({ ...(prior.offense[team] || {}), ...(prior.defense[team] || {}) }, { ...(current.offense[team] || {}), ...(current.defense[team] || {}) }),
        ...combineQb(prior.qb[team] || {}, current.qb[team] || {}),
      };
    }
    const currentGames = Math.max(0, ...Object.values(current.offense).map((r) => r.games || 0));
    const payload = {
      season,
      byTeam,
      meta: {
        source: "nflverse",
        currentSeason: season,
        priorSeason: season - 1,
        teams: Object.keys(byTeam).length,
        currentGames,
        currentRows: current.rows,
        priorRows: prior.rows,
        currentStatus: { team: current.teamStatus, player: current.playerStatus },
        priorStatus: { team: prior.teamStatus, player: prior.playerStatus },
        priorWeightGames: PRIOR_GAMES,
        marketInformed: false,
        limitation: "Weekly summary feed supplies core team EPA/pass/rush and QB EPA/CPOE/sack evidence; success, early-down, explosives and line-yards remain missing until play-by-play feature ETL is added.",
      },
    };
    await writeCache(cacheKey, payload, env.caches, TTL_MS);
    return payload;
  } catch (err) {
    const payload = { season, byTeam: {}, meta: { source: "nflverse", teams: 0, error: String(err?.message || err), marketInformed: false } };
    await writeCache(cacheKey, payload, env.caches, ERR_TTL_MS);
    return payload;
  }
}

function teamFeature(feed, team = {}) {
  const key = canon(team.abbr || team.shortName || team.name);
  return feed.byTeam?.[key] || null;
}

export function attachNflVerseFeatures(games = [], feed = {}) {
  return (games || []).map((game) => {
    if (game.sport && game.sport !== "nfl") return game;
    const home = teamFeature(feed, game.home) || {};
    const away = teamFeature(feed, game.away) || {};
    return {
      ...game,
      nflFeatures: {
        ...(game.nflFeatures || {}),
        home: { ...(game.nflFeatures?.home || {}), ...home },
        away: { ...(game.nflFeatures?.away || {}), ...away },
      },
    };
  });
}
