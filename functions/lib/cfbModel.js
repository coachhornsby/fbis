/**
 * Independent CFB score model (FBIS-v1.3).
 *
 * Runtime sources that actually run:
 *   ESPN scoreboard — records, AP/curated rank, scores, neutralSite, conference, week
 *   ESPN rankings  — AP (and other polls in the same payload) as the weekly/preseason prior
 *   FBIS team_form — current-season points for/against from harvested finals (as-of, no leakage)
 *
 * Not present in this repo and NOT invented:
 *   EPA, success rate, explosiveness, returning production, transfer portal,
 *   QB/coach/coordinator changes, injuries, weather, travel, rest.
 *
 * Early-season blend (documented, versioned):
 *   w_current = n / (n + PRIOR_GAMES) with PRIOR_GAMES = 6
 *   estimate = (1 - w) * preseason_prior + w * current_season_evidence
 *
 * Score identity (enforced):
 *   projected_home + projected_away = projected_total
 *   projected_home - projected_away = projected_margin
 *
 * Win / spread / total probabilities use a Normal with explicit sigma, not a
 * disguised trained model. Sigma is larger in the early season.
 */

import { readCache, writeCache } from "./cache.js";
import { loadTeamForm } from "./store.js";
import { pCoverHome, pGreater } from "./metrics.js";

function todayCT() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const CFB_CONSTANTS = {
  priorGames: 6,
  hfaPoints: 2.5,
  leaguePpg: 26.5,
  leagueTotal: 53,
  marginSigmaBase: 15.5,
  totalSigmaBase: 13.5,
  earlySigmaBoost: 0.35,
  rankScale: 0.85,
  notes: {
    hfa: "Documented 2.5-point FBS home-field prior. Neutral site → 0.",
    priorGames: "Current-season weight = n / (n + 6). Week 0 is almost all prior.",
    sigma: "Margin SD 15.5 and total SD 13.5 are published FBS-scale heuristics, not fitted on FBIS bets.",
    missing: "No EPA/QB/coach/transfer feed is wired. Those inputs are absent, not zero-filled fakes.",
  },
};

const RANK_TTL_MS = 6 * 60 * 60 * 1000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function cfbSeasonYear(date = todayCT()) {
  const y = Number(String(date).slice(0, 4));
  const m = Number(String(date).slice(5, 7));
  return m >= 8 ? y : y - 1;
}

export function powerFromRank(rank) {
  const r = num(rank);
  if (r == null || r <= 0 || r >= 99) return 0;
  return (26 - Math.min(r, 25)) * CFB_CONSTANTS.rankScale;
}

export function earlySeasonWeight(gamesPlayed, priorGames = CFB_CONSTANTS.priorGames) {
  const n = Math.max(0, Number(gamesPlayed) || 0);
  return n / (n + priorGames);
}

export function blendSeason(prior, current, n, priorGames = CFB_CONSTANTS.priorGames) {
  const w = earlySeasonWeight(n, priorGames);
  if (current == null || !Number.isFinite(Number(current))) return { value: prior, w, n };
  if (prior == null || !Number.isFinite(Number(prior))) return { value: Number(current), w, n };
  return { value: (1 - w) * Number(prior) + w * Number(current), w, n };
}

export function projectCfbMatchup({
  homeOff,
  homeDef,
  awayOff,
  awayDef,
  hfa = CFB_CONSTANTS.hfaPoints,
} = {}) {
  const home = round1((Number(homeOff) + Number(awayDef)) / 2 + Number(hfa) / 2);
  const away = round1((Number(awayOff) + Number(homeDef)) / 2 - Number(hfa) / 2);
  return {
    home,
    away,
    total: home + away,
    margin: home - away,
  };
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

export function cfbSigma({ gamesHome = 0, gamesAway = 0 } = {}) {
  const wHome = earlySeasonWeight(gamesHome);
  const wAway = earlySeasonWeight(gamesAway);
  const maturity = (wHome + wAway) / 2;
  const boost = 1 + CFB_CONSTANTS.earlySigmaBoost * (1 - maturity);
  const sample = Math.sqrt(1 + 1 / (gamesHome + 1) + 1 / (gamesAway + 1));
  return {
    margin: round1(CFB_CONSTANTS.marginSigmaBase * boost * sample),
    total: round1(CFB_CONSTANTS.totalSigmaBase * boost * sample),
    maturity,
  };
}

export function cfbWinProb(margin, sigmaMargin) {
  return pGreater(margin, 0, sigmaMargin);
}

export function cfbSpreadProb(margin, homeSpread, sigmaMargin) {
  return pCoverHome(margin, homeSpread, sigmaMargin);
}

export function cfbTotalProb(total, line, sigmaTotal, over = true) {
  const pOver = pGreater(total, line, sigmaTotal);
  if (pOver == null) return null;
  return over ? pOver : 1 - pOver;
}

export function parseEspnRankings(json) {
  const byTeam = new Map();
  const polls = json?.rankings || [];
  const preferred =
    polls.find((p) => /ap/i.test(p?.name || p?.shortName || "")) || polls[0] || null;
  for (const row of preferred?.ranks || []) {
    const team = row.team || {};
    const id = String(team.id || "");
    const abbr = String(team.abbreviation || "").toUpperCase();
    const name = team.displayName || team.nickname || "";
    const rank = num(row.current);
    if (!id && !abbr) continue;
    const entry = { id, abbr, name, rank, poll: preferred?.name || "AP" };
    if (id) byTeam.set(`id:${id}`, entry);
    if (abbr) byTeam.set(`abbr:${abbr}`, entry);
    if (name) byTeam.set(`name:${String(name).toLowerCase()}`, entry);
  }
  return { poll: preferred?.name || null, season: json?.leagues?.[0]?.season?.year || null, byTeam };
}

function teamKey(team) {
  if (team?.espnId) return `id:${team.espnId}`;
  if (team?.abbr && team.abbr !== "—") return `abbr:${String(team.abbr).toUpperCase()}`;
  return `name:${String(team?.name || "").toLowerCase()}`;
}

function lookupRank(index, team) {
  return (
    index.byTeam.get(`id:${team?.espnId}`) ||
    index.byTeam.get(`abbr:${String(team?.abbr || "").toUpperCase()}`) ||
    index.byTeam.get(`name:${String(team?.name || "").toLowerCase()}`) ||
    null
  );
}

function gamesFromRecord(rec) {
  const m = String(rec || "").match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return 0;
  return Number(m[1]) + Number(m[2]);
}

function priorUnit(power) {
  return {
    off: CFB_CONSTANTS.leaguePpg + power * 0.45,
    def: CFB_CONSTANTS.leaguePpg - power * 0.45,
    power,
  };
}

export function estimateTeam(team, { rankings, form, rankFallback } = {}) {
  const ranked = lookupRank(rankings || { byTeam: new Map() }, team);
  const rank = ranked?.rank ?? (team?.rank && team.rank < 99 ? team.rank : rankFallback ?? null);
  const power = powerFromRank(rank);
  const prior = priorUnit(power);
  const key = teamKey(team);
  const row = form?.get(key) || form?.get(`abbr:${String(team?.abbr || "").toUpperCase()}`) || null;
  const n = row?.games ?? gamesFromRecord(team?.record);
  const currentOff = row?.pointsFor != null && row.games ? row.pointsFor / row.games : null;
  const currentDef = row?.pointsAgainst != null && row.games ? row.pointsAgainst / row.games : null;
  const off = blendSeason(prior.off, currentOff, n);
  const def = blendSeason(prior.def, currentDef, n);
  return {
    key,
    rank,
    poll: ranked?.poll || null,
    n,
    power,
    priorOff: prior.off,
    priorDef: prior.def,
    currentOff,
    currentDef,
    off: off.value,
    def: def.value,
    w: off.w,
    flags: [
      rank == null ? "unranked" : null,
      n < 3 ? "early_season" : null,
      currentOff == null ? "no_current_ppg" : null,
    ].filter(Boolean),
  };
}

export function projectCfbGame(game, ctx = {}) {
  const home = estimateTeam(game.home, ctx);
  const away = estimateTeam(game.away, ctx);
  const hfa = game.neutralSite ? 0 : CFB_CONSTANTS.hfaPoints;
  const scores = projectCfbMatchup({
    homeOff: home.off,
    homeDef: home.def,
    awayOff: away.off,
    awayDef: away.def,
    hfa,
  });
  const sig = cfbSigma({ gamesHome: home.n, gamesAway: away.n });
  const completeness =
    1 -
    [home.rank == null, away.rank == null, home.currentOff == null, away.currentOff == null].filter(Boolean).length *
      0.15;
  const flags = [
    ...home.flags.map((f) => `home_${f}`),
    ...away.flags.map((f) => `away_${f}`),
    game.neutralSite ? "neutral_site" : null,
    home.n < 3 || away.n < 3 ? "early_season" : null,
  ].filter(Boolean);
  return {
    ...scores,
    hfa,
    homeEst: home,
    awayEst: away,
    sigmaMargin: sig.margin,
    sigmaTotal: sig.total,
    maturity: sig.maturity,
    dataQuality: Math.round(Math.max(0.25, Math.min(1, completeness)) * 100),
    flags,
    constants: {
      priorGames: CFB_CONSTANTS.priorGames,
      hfaPoints: hfa,
      model: "cfb-prior-v1",
    },
  };
}

async function fetchEspnJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,text/plain,*/*",
      Referer: "https://www.espn.com/",
    },
  });
  if (!res.ok) throw new Error(`ESPN CFB ${res.status}`);
  return res.json();
}

export async function loadCfbRankings(cfCache) {
  const key = "cfb-rankings-v1";
  const cached = await readCache(key, cfCache, RANK_TTL_MS);
  if (cached?.byTeam) {
    return { ...cached, byTeam: new Map(cached.byTeam) };
  }
  const json = await fetchEspnJson("https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings");
  const parsed = parseEspnRankings(json);
  await writeCache(key, { poll: parsed.poll, season: parsed.season, byTeam: [...parsed.byTeam.entries()] }, cfCache, RANK_TTL_MS);
  return parsed;
}

export async function applyCfbModel(games, env = {}) {
  let rankings = { byTeam: new Map(), poll: null };
  try {
    rankings = await loadCfbRankings(env.caches);
  } catch (err) {
    rankings = { byTeam: new Map(), poll: null, error: String(err?.message || err) };
  }
  const season = cfbSeasonYear();
  const form = await loadTeamForm(env, "cfb", season);
  const next = (games || []).map((game) => {
    if (game.sport && game.sport !== "cfb") return game;
    const marketHome =
      game.odds?.total != null && game.odds?.spread != null
        ? game.odds.total / 2 - game.odds.spread / 2
        : null;
    const marketAway =
      game.odds?.total != null && game.odds?.spread != null
        ? game.odds.total / 2 + game.odds.spread / 2
        : null;
    const proj = projectCfbGame(game, { rankings, form });
    return {
      ...game,
      marketProjHome: marketHome,
      marketProjAway: marketAway,
      projHomeScore: proj.home,
      projAwayScore: proj.away,
      cfb: proj,
    };
  });
  return {
    games: next,
    meta: {
      enabled: true,
      poll: rankings.poll || null,
      ranked: rankings.byTeam?.size || 0,
      formTeams: form.size,
      error: rankings.error || null,
      constants: CFB_CONSTANTS,
    },
  };
}

/** Used by harvest to fold a final into as-of team form without touching pregame snapshots. */
export function formDelta(final) {
  const hs = num(final.home?.score);
  const as = num(final.away?.score);
  if (hs == null || as == null) return [];
  return [
    { team: final.home, pointsFor: hs, pointsAgainst: as },
    { team: final.away, pointsFor: as, pointsAgainst: hs },
  ];
}

